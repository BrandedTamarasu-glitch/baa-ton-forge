import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { laneStatus } from './status.js';
import { selectDispatchAudit } from './dispatch-audit.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const absent = 'absent-in-inspected-source';
export function diagnosisStep(code, label, reason, tool = null, args = null) {
  return { code, label, reason, tool, arguments: args, executionSupported: false };
}

// Pure projection. Claims here describe saved evidence, never current liveness.
export function projectDiagnosis({ status, taskId, workflow, records, manifestSha256, observedAt }) {
  const task = status.tasks.find(item => item.taskId === taskId);
  if (!task) throw new Error(`Unknown task: ${taskId}`);
  const scope = { sourcePath: status.sourcePath, sourceSha256: status.sourceSha256, taskId,
    root: status.current.root, sessionFile: status.current.sessionFile,
    paneId: status.current.paneId, workspaceId: status.current.workspaceId };
  const mappings = records.filter(item => item.kind === 'planned' && item.taskId === taskId &&
    item.root === scope.root && item.sourcePath === scope.sourcePath && item.sourceSha256 === scope.sourceSha256);
  const audit = selectDispatchAudit(records, task.workflowId, scope);
  const report = { version: 1, mode: 'workflow-diagnosis', executed: false, authorization: 'not-assessed',
    nativeReadiness: 'not-inspected', observedAt, current: status.current,
    sourcePath: status.sourcePath, sourceSha256: status.sourceSha256, manifestPath: status.manifestPath, manifestSha256,
    taskId, workflowId: task.workflowId, owner: task.owner, diagnosis: null,
    facts: [], gaps: [], blockers: [...task.blockers], warnings: [...status.warnings],
    requests: { questions: task.pendingQuestions, approvals: task.pendingApprovals, answers: task.pendingAnswers },
    recovery: { state: 'not-assessed', command: null }, nextStep: null,
    stopReason: 'Inspection only. No action, verification, approval or resource change was performed.' };
  const fact = (name, value, source, state = value === null || value === undefined || value === false ? absent : 'present') =>
    report.facts.push({ name, state, value: value ?? null, source });
  const set = (code, label, reason, tool = null, args = null) => {
    report.diagnosis = code; report.nextStep = diagnosisStep(code, label, reason, tool, args); return report;
  };
  if (!status.manifestReadable || !workflow || mappings.length === 0 ||
      new Set(mappings.map(item => item.workflowId)).size !== 1 || mappings[0].workflowId !== task.workflowId ||
      task.blockers.length || task.nextAction.code === 'resume-owning-root') {
    report.gaps.push('An unambiguous matching brief, mapping, ledger and owning session are required. Native-only workflows are not supported here.');
    return set('ownership-or-evidence-blocked', 'Inspect mapping and ownership', task.blockers[0] ?? report.gaps[0]);
  }
  const lanes = workflow.lanes;
  fact('workflow-status', workflow.status, 'manifest');
  fact('source-workspace', workflow.worktreeBinding?.repoParent?.workspaceId, 'manifest');
  for (const lane of lanes) {
    const ref = `manifest:${workflow.id}/${lane.id ?? 'lane'}`;
    for (const key of ['agentStartAttemptedAt', 'agentStartedAt', 'promptAttemptedAt', 'promptedAt']) fact(key, lane[key], ref);
    fact('saved-pane', lane.paneId, ref);
    fact('receipt', lane.completionReceipt ? { id: lane.completionReceipt.id, delivery: lane.completionReceipt.delivery ?? 'unknown' } : null, ref);
  }
  fact('dispatch-audit', audit.attempts.map(({ intent, calls, results }) => ({ intentId: intent.intentId,
    retryOf: intent.retryOf ?? null, attempted: calls.length > 0,
    outcome: results[0]?.outcome ?? null, at: results[0]?.recordedAt ?? intent.recordedAt ?? null })), 'current-session-branch', audit.attempts.length ? 'present' : absent);
  fact('root-verification', task.verification ? { commit: task.verification.commit, verifiedAt: task.verification.verifiedAt } : null, 'current-session-branch');
  fact('live-child-and-source', null, 'native', 'not-inspected');
  report.gaps.push('Live child, source binding, startup proof and saved provider-session availability have not been inspected.');
  report.blockers.push(...audit.conflicts);
  if (audit.conflicts.length) return set('conflicting-audit', 'Inspect conflicting dispatch evidence', audit.conflicts[0]);
  if (task.completionReceipts === task.laneCount && task.laneCount > 0) {
    if (task.verification) return set('verified-historical', 'No further lane action', 'Root verification is historical; no checks were rerun and no cleanup is implied.');
    return set('completion-awaiting-verification', 'Independently verify completion',
      'Durable receipts are stored. Notification delivery does not gate independent verification; do not redispatch or resend.',
      'forgeflow_verification_guidance', { filename: status.sourcePath, taskId });
  }
  if (lanes.some(lane => lane.promptAttemptedAt || lane.promptedAt) || workflow.dispatchedAt ||
      audit.attempts.some(({ calls, results }) => calls.length &&
        (results.length !== 1 || results[0].outcome === 'unknown' || results[0].outcome === 'dispatch-reported'))) {
    report.recovery.state = 'replay-blocked';
    return set('assignment-unresolved', 'Inspect the existing submission',
      'Submission has possible effects without complete durable receipts. Missing output or transcripts does not prove non-delivery. Do not retry, redispatch or replace automatically.',
      'herdr_observe', { workflowId: workflow.id });
  }
  if (task.pendingQuestions.length || task.pendingApprovals.length || task.pendingAnswers.length)
    return set('parent-request-pending', task.nextAction.label, task.nextAction.reason);
  const last = audit.attempts.at(-1);
  if (lanes.length === 1 && workflow.retry?.failedStage === 'agent-start' && workflow.retry.state === 'retryable' &&
      /\bagent_not_ready\b/.test(workflow.retry.error ?? '') && lanes[0].agentKind === 'claude' &&
      last?.calls.length === 1 && last.results.length === 1 && last.results[0].outcome === 'error' &&
      last.results[0].isError === true && /\bagent_not_ready\b/.test(last.results[0].resultText ?? '')) {
    report.recovery.state = 'candidate-only';
    return set('startup-before-assignment', 'Inspect startup recovery prerequisites',
      'Saved startup failed before any recorded assignment. Fresh original-child, profile and attestation checks are still required; this is not permission to retry.',
      'forgeflow_diagnose_lane', { filename: status.sourcePath, taskId, inspectNative: true });
  }
  if (!last && !lanes.some(lane => lane.agentStartAttemptedAt || lane.paneId || lane.startupIntentPath) && workflow.status === 'planned')
    return set('no-recorded-attempt', 'Check planned workflow readiness',
      'No dispatch attempt was found in this branch or selected ledger. Other histories remain unassessed.',
      'forgeflow_check_readiness', { filename: status.sourcePath });
  return set('execution-unresolved', 'Inspect existing workflow evidence',
    'Saved evidence does not establish completion or safe recovery. Do not infer readiness from a status label.', 'herdr_observe', { workflowId: workflow.id });
}

export async function collectDiagnosis(options) {
  const status = await laneStatus(options);
  let bytes = null, workflow = null;
  if (status.manifestReadable) {
    bytes = await readFile(status.manifestPath);
    const task = status.tasks.find(item => item.taskId === options.taskId);
    const matches = JSON.parse(bytes).workflows.filter(item => item.id === task?.workflowId);
    if (matches.length === 1) workflow = matches[0];
  }
  const report = projectDiagnosis({ status, taskId: options.taskId, workflow, records: options.records ?? [],
    manifestSha256: bytes ? digest(bytes) : null, observedAt: new Date().toISOString() });
  if (!isDeepStrictEqual(status, await laneStatus(options)) || bytes && !bytes.equals(await readFile(status.manifestPath))) {
    report.diagnosis = 'stale-snapshot'; report.recovery = { state: 'blocked', command: null };
    report.nextStep = diagnosisStep('inspect-again', 'Inspect again', 'Evidence changed during collection; no recovery eligibility accepted.');
  }
  return { report, workflow };
}

export function renderDiagnosis(report) {
  const text = value => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const detail = value => { const s = text(value); return s.length > 1200 ? `${s.slice(0, 1200)} [truncated; inspect referenced evidence]` : s; };
  return [
    `Diagnosis: ${report.diagnosis}`, `Task: ${text(report.taskId)} | Workflow: ${text(report.workflowId ?? 'unmapped')}`,
    `Next: ${text(report.nextStep.label)}`, text(report.nextStep.reason),
    `Observed: ${report.observedAt} | Native inspection: ${report.nativeReadiness}`,
    `Brief: ${text(report.sourcePath)}`, `Manifest: ${text(report.manifestPath)} | SHA256: ${report.manifestSha256 ?? 'unavailable'}`,
    'Read-only evidence; authorization not assessed. Saved verification is not a fresh test run.',
    ...report.facts.map(f => `${f.name} [${f.state}; ${text(f.source)}]: ${detail(JSON.stringify(f.value))}`),
    ...report.gaps.map(item => `Gap: ${detail(item)}`), ...report.blockers.map(item => `Blocked: ${detail(item)}`),
    ...report.warnings.map(item => `Warning: ${detail(item)}`),
    ...Object.entries(report.requests).flatMap(([kind, items]) => (items ?? []).map(item => `Pending ${kind}: ${detail(JSON.stringify(item))}`)),
    ...(report.nextStep.tool ? [`Suggested tool (not executed): ${report.nextStep.tool}`, JSON.stringify(report.nextStep.arguments)] : []),
    ...(report.recovery.command ? ['Eligible-at-inspection command; fresh native confirmation and guards still required:', report.recovery.command] : []),
    report.stopReason,
  ].join('\n');
}
