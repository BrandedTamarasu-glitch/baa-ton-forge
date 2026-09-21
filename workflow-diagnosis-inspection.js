import { realpath } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { inspectNativeRoot } from './preflight.js';
import { checkStartupRetry } from './dispatch-retry.js';
import { selectDispatchAudit } from './dispatch-audit.js';
import { collectDiagnosis, diagnosisStep } from './workflow-diagnosis.js';

const blocked = new Set(['ownership-or-evidence-blocked', 'conflicting-audit', 'stale-snapshot']);
// No terminal reads, arbitrary executable names, mutations or polling.
function permitted(args, rootPane, workflow) {
  return args[0] === 'agent' && args[1] === 'get' && args.length === 3 &&
      [rootPane, ...workflow.lanes.map(lane => lane.paneId)].includes(args[2]) ||
    args[0] === 'pane' && args[1] === 'get' && args.length === 3 && workflow.lanes.some(lane => lane.paneId === args[2]) ||
    args[0] === 'pane' && args[1] === 'process-info' && args.length === 4 && args[2] === '--pane' && workflow.lanes.some(lane => lane.paneId === args[3]) ||
    args[0] === 'workspace' && args[1] === 'list' && args.length === 2 ||
    args[0] === 'worktree' && args[1] === 'list' && args[2] === '--cwd' && args.length === 4 && args[3] === workflow.cwd;
}

// An overall deadline also bounds hosts that ignore per-call cancellation.
export async function inspectDiagnosis(options, snapshot) {
  const { workflow } = snapshot;
  const report = structuredClone(snapshot.report);
  const originalRecords = structuredClone(options.records ?? []);
  if (blocked.has(report.diagnosis)) return report;
  const controller = new AbortController();
  let timer, abort;
  const deadline = new Promise((_, reject) => {
    abort = () => { controller.abort(); reject(new Error('Native inspection cancelled')); };
    options.signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(new Error('Native inspection timed out')); }, 15000);
    if (options.signal?.aborted) abort();
  });
  const exec = async (binary, args, settings) => {
    controller.signal.throwIfAborted();
    if (!permitted(args, report.current.paneId, workflow)) throw new Error('Unsupported diagnostic inspection');
    if (typeof options.exec !== 'function') throw new Error('Native inspection transport unavailable');
    const result = await options.exec(binary, args, { ...settings, timeout: 15000, signal: controller.signal });
    controller.signal.throwIfAborted();
    if (Buffer.byteLength(result.stdout ?? '') + Buffer.byteLength(result.stderr ?? '') > 256 * 1024) throw new Error('Native inspection response exceeds 256 KiB');
    return result;
  };
  const live = { ...options, exec, signal: controller.signal };
  const facts = [], gaps = [];
  const fact = (name, state, value, source) => facts.push({ name, state, value, source });
  async function work() {
    const root = await inspectNativeRoot({ ...live, prepared: { root: report.current.root } });
    async function query(args, missingCode) {
      const result = await exec(options.env?.HERDR_BIN_PATH || process.env.HERDR_BIN_PATH || 'herdr', args, { cwd: options.cwd });
      let raw;
      try { raw = JSON.parse(result.stdout || result.stderr); } catch { throw new Error('Native inspection returned invalid JSON'); }
      if (result.code !== 0 || raw.error || raw.ok === false) {
        if (missingCode && raw.error?.code === missingCode) return null;
        throw new Error(`Native inspection failed for ${args.slice(0, 2).join(' ')}; no absence inferred`);
      }
      const data = raw.result ?? raw;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Malformed native inspection');
      return data;
    }
    fact('native-root', 'present', root.readiness.root, 'native-root-proof');
    const critical = [];
    async function observe(args, missingCode) {
      const value = await query(args, missingCode); critical.push({ args, missingCode, value }); return value;
    }
    for (const lane of workflow.lanes) {
      if (!lane.paneId) { fact('live-child', 'not-inspected', null, 'no-recorded-pane'); continue; }
      const args = ['agent', 'get', lane.paneId];
      const result = await observe(args, 'agent_not_found');
      if (result) {
        const a = result.agent;
        if (!a || a.pane_id !== lane.paneId || a.workspace_id !== report.current.workspaceId || a.agent !== lane.agentKind)
          throw new Error('Native child identity conflicts with the selected lane');
        const saved = lane.nativeSession ?? lane.persistenceHandle?.nativeHandle;
        const sessionMatches = saved ? isDeepStrictEqual(saved, { kind: a.agent_session?.kind, value: a.agent_session?.value }) : null;
        fact('live-child', sessionMatches === false ? 'conflicting' : 'present',
          { paneId: a.pane_id, status: a.agent_status, interactiveReady: a.interactive_ready === true,
            session: a.agent_session ? { kind: a.agent_session.kind, value: a.agent_session.value } : null, savedSessionMatches: sessionMatches }, args.join(' '));
        if (sessionMatches === false) throw new Error('Native child session differs from the saved session');
      } else {
        fact('live-agent', 'absent-in-inspected-source', null, args.join(' '));
        const pane = await observe(['pane', 'get', lane.paneId], 'pane_not_found');
        if (pane && (pane.pane?.pane_id !== lane.paneId || pane.pane?.workspace_id !== report.current.workspaceId))
          throw new Error('Native pane identity conflicts with the selected lane');
        fact('live-pane', pane ? 'present' : 'absent-in-inspected-source', pane ? { paneId: lane.paneId } : null, 'pane get');
        if (pane) {
          const info = (await observe(['pane', 'process-info', '--pane', lane.paneId])).process_info;
          if (!info || !Array.isArray(info.foreground_processes)) throw new Error('Native foreground process information unavailable');
          fact('foreground-shell', 'present', { shellPid: info.shell_pid ?? null,
            soleForegroundShell: Boolean(info.shell_pid && info.foreground_processes.length === 1 && info.foreground_processes[0].pid === info.shell_pid) }, 'pane process-info');
        }
        gaps.push('Provider-session availability is unproven. Missing agent or transcript evidence does not establish safe replay or resumability.');
      }
    }
    let sourceChanged = false;
    if (workflow.worktreeBinding) {
      const inventory = await observe(['worktree', 'list', '--cwd', workflow.cwd]);
      const spaces = (await observe(['workspace', 'list'])).workspaces;
      if (!Array.isArray(spaces) || !inventory.source) throw new Error('Native source inventory unavailable');
      const saved = workflow.worktreeBinding.repoParent, current = inventory.source;
      sourceChanged = !saved?.workspaceId || current.source_workspace_id !== saved.workspaceId ||
        !current.source_checkout_path || !saved.checkoutPath || await realpath(current.source_checkout_path) !== await realpath(saved.checkoutPath) ||
        current.repo_key !== saved.repoKey || spaces.filter(s => s.workspace_id === saved.workspaceId).length !== 1;
      fact('live-source-binding', sourceChanged ? 'conflicting' : 'present',
        { recorded: saved?.workspaceId ?? null, observed: current.source_workspace_id ?? null }, 'worktree list / workspace list');
    } else fact('live-source-binding', 'not-inspected', null, 'no-recorded-source-binding');
    let eligibility = null;
    if (report.recovery.state === 'candidate-only') {
      const prior = selectDispatchAudit(options.records ?? [], workflow.id).attempts.at(-1)?.intent;
      const latest = selectDispatchAudit(options.records ?? []).attempts.at(-1)?.intent;
      if (prior?.intentId !== latest?.intentId)
        throw new Error('The existing startup-retry command targets a newer dispatch intent. Selected workflow inspection cannot authorize that command.');
      // Shared production checker; it revalidates scope, clean checkout and proofs.
      eligibility = await checkStartupRetry({ ...live, previous: prior });
    }
    const freshRecords = options.getRecords ? options.getRecords() : options.records ?? [];
    if (!isDeepStrictEqual(originalRecords, freshRecords)) throw new Error('Session evidence changed during native inspection');
    const after = await collectDiagnosis({ ...options, records: freshRecords });
    if (report.manifestSha256 !== after.report.manifestSha256 || report.sourceSha256 !== after.report.sourceSha256 ||
        !isDeepStrictEqual(snapshot.workflow, after.workflow) || blocked.has(after.report.diagnosis)) throw new Error('Evidence changed during native inspection');
    const freshRoot = await inspectNativeRoot({ ...live, prepared: { root: report.current.root } });
    if (!isDeepStrictEqual(root.readiness, freshRoot.readiness)) throw new Error('Root identity changed during inspection');
    for (const item of critical) if (!isDeepStrictEqual(item.value, await query(item.args, item.missingCode)))
      throw new Error('Native evidence changed during inspection; inspect again');
    if (eligibility) {
      const prior = selectDispatchAudit(options.records ?? [], workflow.id).attempts.at(-1)?.intent;
      const fresh = await checkStartupRetry({ ...live, previous: prior });
      if (!isDeepStrictEqual(eligibility, fresh)) throw new Error('Startup proof changed during inspection');
    }
    controller.signal.throwIfAborted();
    report.nativeReadiness = 'inspected';
    if (sourceChanged) {
      report.blockers.push('Recorded source workspace binding is missing or changed; do not recreate or rebind automatically.');
      if (!['completion-awaiting-verification', 'verified-historical', 'assignment-unresolved'].includes(report.diagnosis)) {
        report.diagnosis = 'source-binding-changed';
        report.nextStep = diagnosisStep('inspect-source', 'Inspect the recorded source binding', report.blockers.at(-1));
      }
    }
    if (eligibility) {
      const filename = report.sourcePath;
      if (/[\r\n"\x00-\x1f\x7f]/.test(filename)) throw new Error('Brief path cannot be rendered as a safe single-line command');
      report.recovery = { state: 'eligible-at-inspection', command: `/forgeflow-retry-startup "${filename}"` };
      report.nextStep = diagnosisStep('review-startup-retry', 'Review guarded startup recovery',
        'Original-child checks passed at inspection time. The existing command still requires fresh guards and native user confirmation.');
    }
  }
  try { await Promise.race([work(), deadline]); }
  catch (error) {
    report.nativeReadiness = 'incomplete'; report.recovery = { state: 'blocked', command: null };
    report.blockers.push(error instanceof Error ? error.message : String(error));
    report.nextStep = diagnosisStep('inspect-incomplete', 'Resolve the native evidence gap', report.blockers.at(-1));
  } finally {
    controller.abort(); clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
  }
  if (report.nativeReadiness === 'inspected') {
    report.facts = report.facts.filter(item => item.name !== 'live-child-and-source');
  } else if (facts.length) {
    report.facts = report.facts.map(item => item.name === 'live-child-and-source'
      ? { ...item, state: 'unavailable', value: 'Native inspection incomplete; see specific facts and blockers.' }
      : item);
  }
  report.facts.push(...facts);
  report.gaps.push(...gaps);
  if (report.nativeReadiness === 'inspected' || facts.length)
    report.gaps = report.gaps.filter(gap => !gap.startsWith('Live child, source binding'));
  if (report.nativeReadiness === 'incomplete' && facts.length)
    report.gaps.push('Native inspection is incomplete; only the specific facts shown were collected. Provider-session availability remains unproven.');
  report.gaps.push('No provider transcript search, resume, tests or execution occurred. Native inspection does not establish runtime entitlement or authorization.');
  return report;
}

export async function diagnoseLane(options) {
  const snapshot = await collectDiagnosis(options);
  return options.inspectNative ? inspectDiagnosis(options, snapshot) : snapshot.report;
}
