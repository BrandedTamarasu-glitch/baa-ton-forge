import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { checkContinuation } from './continuation-readiness.js';
import { nativeSessionOptions } from './native-pi-identity.js';
import { checkStartupRetry } from './dispatch-retry.js';
import { selectDispatchAudit } from './dispatch-audit.js';

const ENTRY = 'forgeflow-adapter';
const message = error => error instanceof Error ? error.message : String(error);
function fingerprint(report) {
  return createHash('sha256').update(JSON.stringify({ sourcePath: report.sourcePath, sourceSha256: report.sourceSha256,
    current: report.current, step: report.proposedStep, evidence: report.readiness.evidence })).digest('hex');
}
function dispatchable(report) {
  if (report.readiness?.state !== 'passed' || !(report.proposedStep?.code === 'review-dispatch' ||
      (report.mode === 'startup-retry' && report.proposedStep?.code === 'review-startup-retry')) || !report.proposedStep.workflowId)
    throw new Error(`Single dispatch requires a mapped planned workflow with passing readiness: ${report.readiness?.blockers?.join('; ') || report.stopReason}`);
}

// Pi has no cross-extension executeTool API. A confirmed command requests one
// ordinary native tool call; the hooks recheck and audit that call, not a shell substitute.
export function registerDispatchOnce(pi, records, inspect = checkContinuation, inspectRetry = checkStartupRetry) {
  let checking = false;
  let stopThisTurn = false;
  let armedIntentId = null;
  const append = record => pi.appendEntry(ENTRY, { ...record, recordedAt: new Date().toISOString() });
  const latest = ctx => records(ctx).findLast(item => item.kind === 'dispatch-intent');
  const children = (ctx, intent) => records(ctx).filter(item => item.intentId === intent.intentId);
  const inspectHere = (filename, ctx, previous = null) => (previous ? inspectRetry : inspect)({ filename, previous, cwd: ctx.cwd, records: records(ctx),
    sessionFile: ctx.sessionManager.getSessionFile(), ...nativeSessionOptions(pi, ctx), exec: pi.exec?.bind(pi), signal: ctx.signal });

  pi.registerCommand('forgeflow-dispatch-audit', {
    description: 'Show single-dispatch audit in this session; no execution or recovery',
    handler: async (args, ctx) => {
      const workflowId = args.trim() || null;
      if (workflowId && !/^[a-zA-Z0-9_-]+$/.test(workflowId)) {
        ctx.ui.notify('Usage: /forgeflow-dispatch-audit [workflow-id] (one line)', 'error'); return;
      }
      const selected = selectDispatchAudit(records(ctx), workflowId);
      const audit = selected.audit;
      pi.sendMessage({ customType: 'forgeflow-dispatch-audit', display: true,
        content: audit.length ? `${workflowId ? `Selected workflow ${workflowId}` : 'Latest single-dispatch'} audit (current session branch only):\n${JSON.stringify(audit, null, 2)}\n${selected.conflicts.join('\n')}\nA missing result is unresolved, not proof of no effect. No retry is authorized.` : 'No matching single-dispatch audit in this session branch. This does not prove a workflow was never dispatched.',
        details: { audit, workflowId: selected.workflowId, conflicts: selected.conflicts } }, { triggerTurn: false });
    },
  });

  for (const retry of [false, true]) pi.registerCommand(retry ? 'forgeflow-retry-startup' : 'forgeflow-dispatch-once', {
    description: retry ? 'Confirm one retry of a proven unprompted Claude startup, reusing its existing child' : 'Confirm and hand off one existing workflow to native Baa-ton dispatch; no retry',
    handler: async (args, ctx) => {
      if (checking) { ctx.ui.notify('Another dispatch confirmation is in progress', 'error'); return; }
      checking = true;
      try {
        const filename = args.trim().replace(/^"(.*)"$/, '$1');
        if (!filename) throw new Error(`Usage: /${retry ? 'forgeflow-retry-startup' : 'forgeflow-dispatch-once'} "path/to/brief.md"`);
        if (/[\r\n]/.test(filename) || filename.includes('"')) throw new Error('Paste only the command and brief path on one line; send follow-up instructions separately');
        if (!ctx.hasUI || typeof ctx.ui.confirm !== 'function' || !ctx.isIdle()) throw new Error('Single dispatch requires an idle interactive owning Pi root and native confirmation UI');
        if (!pi.getActiveTools?.().includes('herdr_dispatch')) throw new Error('Native herdr_dispatch is unavailable; no substitute will be used');
        const previous = latest(ctx);
        if (retry && !previous) throw new Error('No consumed dispatch attempt in this session to inspect');
        if (previous && !children(ctx, previous).some(item => item.kind === 'dispatch-result')) throw new Error('An earlier handoff has no result; inspect it before continuing. No automatic retry.');
        const source = path.resolve(ctx.cwd, filename);
        const report = await inspectHere(source, ctx, retry ? previous : null); dispatchable(report);
        if (!retry && records(ctx).some(item => item.kind === 'dispatch-intent' && item.workflowId === report.proposedStep.workflowId))
          throw new Error('This workflow already has a single-dispatch intent; inspect its audit and Baa-ton ledger, do not retry through this command');
        const approved = await ctx.ui.confirm(retry ? 'Retry this existing unprompted child once?' : 'Dispatch one existing workflow?',
          `Workflow: ${report.proposedStep.workflowId}\nTask: ${report.proposedStep.taskId}\nBrief: ${report.sourcePath}\nProfiles: ${JSON.stringify(report.readiness.evidence.profiles)}\n${retry ? `Prior attempt: ${previous.intentId}\nExisting child to reuse: ${JSON.stringify(report.readiness.evidence.child)}\nKnown failure: agent_not_ready before any prompt attempt.\n` : ''}Allow one native herdr_dispatch attempt and a Pi model turn to request it? Baa-ton retains its own approval/startup checks. No restart, additional retry, verification, integration or next lane is authorized.`);
        if (!approved) { ctx.ui.notify('Dispatch handoff cancelled; nothing submitted', 'info'); return; }
        const fresh = await inspectHere(source, ctx, retry ? previous : null); dispatchable(fresh);
        if (fingerprint(report) !== fingerprint(fresh)) throw new Error('Readiness changed during confirmation; no handoff submitted');
        const intent = { kind: 'dispatch-intent', intentId: randomUUID(), sourcePath: fresh.sourcePath,
          sourceSha256: fresh.sourceSha256, root: fresh.current.root, sessionFile: fresh.current.sessionFile,
          paneId: fresh.current.paneId, workspaceId: fresh.current.workspaceId,
          taskId: fresh.proposedStep.taskId, workflowId: fresh.proposedStep.workflowId,
          fingerprint: fingerprint(fresh), approval: 'native-ui-confirmed',
          ...(retry ? { retryOf: previous.intentId, retryMode: 'unprompted-claude-startup' } : {}),
          arguments: { workflowId: fresh.proposedStep.workflowId, execute: true } };
        append(intent);
        armedIntentId = intent.intentId;
        pi.sendMessage({ customType: 'forgeflow-dispatch-handoff', display: true,
          content: `Native user confirmation recorded for one Baa-ton dispatch attempt. Call the registered herdr_dispatch tool once with exactly ${JSON.stringify(intent.arguments)}. Do not use shell imports or a substitute. Do not set confirm or restart. After its result, report it and stop: no retries, verification, integration, cleanup or next-lane progression. If unavailable, stop and report.`,
          details: intent }, { triggerTurn: true });
      } catch (error) { armedIntentId = null; ctx.ui.notify(message(error), 'error'); }
      finally { checking = false; }
    },
  });

  pi.on('tool_call', async (event, ctx) => {
    if (stopThisTurn) return { block: true, reason: 'Single dispatch is finished for this turn. Report the result and stop.' };
    const intent = latest(ctx);
    if (!intent) return;
    const history = children(ctx, intent);
    const done = history.some(item => item.kind === 'dispatch-result');
    if (done) {
      if (event.toolName === 'herdr_dispatch' && event.input?.execute === true &&
          records(ctx).some(item => item.kind === 'dispatch-intent' && item.workflowId === event.input.workflowId))
        return { block: true, reason: 'Single-dispatch attempt already consumed; inspect its result and durable ledger. No automatic retry.' };
      return;
    }
    if (event.toolName !== 'herdr_dispatch' || !isDeepStrictEqual(event.input, intent.arguments))
      return { block: true, reason: 'Single-dispatch handoff permits only the exact recorded native herdr_dispatch call. Stop rather than substitute another operation.' };
    if (armedIntentId !== intent.intentId || checking || history.some(item => item.kind === 'dispatch-attempt' || item.kind === 'dispatch-blocked'))
      return { block: true, reason: 'Dispatch handoff is checking, consumed or blocked; inspect the durable audit. No retry.' };
    checking = true;
    try {
      const previous = intent.retryOf ? records(ctx).find(item => item.kind === 'dispatch-intent' && item.intentId === intent.retryOf) : null;
      if (intent.retryOf && !previous) throw new Error('Original startup attempt is unavailable');
      const fresh = await inspectHere(intent.sourcePath, ctx, previous); dispatchable(fresh);
      if (fingerprint(fresh) !== intent.fingerprint) throw new Error('Root, session, checkout, profile or source evidence changed after confirmation');
      append({ ...intent, kind: 'dispatch-attempt', toolCallId: event.toolCallId });
    } catch (error) {
      armedIntentId = null;
      // A failed audit write must still return a blocking hook result. Throwing
      // here could be treated by the host as an extension error, not a veto.
      try { append({ ...intent, kind: 'dispatch-blocked', toolCallId: event.toolCallId, reason: message(error) }); }
      catch { stopThisTurn = true; }
      return { block: true, reason: message(error) };
    } finally { checking = false; }
  });
  pi.on('tool_result', (event, ctx) => {
    if (event.toolName !== 'herdr_dispatch') return;
    const attempt = records(ctx).findLast(item => item.kind === 'dispatch-attempt' && item.toolCallId === event.toolCallId);
    if (!attempt || children(ctx, attempt).some(item => item.kind === 'dispatch-result')) return;
    const details = event.details;
    const outcome = event.isError ? 'error' : details?.workflow?.id !== attempt.workflowId ? 'unknown'
      : details.cancelled ? 'cancelled' : details.parentApprovalRequired ? 'approval-required'
      : details.dispatched === true && !details.dryRun ? 'dispatch-reported' : 'unknown';
    armedIntentId = null;
    append({ ...attempt, kind: 'dispatch-result', outcome, isError: Boolean(event.isError),
      resultText: (event.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n') });
    stopThisTurn = true;
    ctx.ui.notify(`Single dispatch stopped: ${outcome}. Inspect durable evidence; no completion or verification is implied.`, 'info');
  });
  pi.on('agent_end', () => { stopThisTurn = false; });
}
