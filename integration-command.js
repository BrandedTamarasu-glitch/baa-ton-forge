import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { integrationPreview, renderIntegration } from './integration.js';
import { inspectNativeRoot, nativePreflight } from './preflight.js';
import { nativeSessionOptions } from './native-pi-identity.js';
import { checkout } from './prepare.js';
import { resolveValidatedTask } from './verification-handoff.js';

const ENTRY = 'forgeflow-adapter';
const message = error => error instanceof Error ? error.message : String(error);
async function integrationNativeProof(options) {
  return options.prepared.planArguments?.worktreeCwd
    ? { readiness: await nativePreflight({ ...options, ensureSource: false }) }
    : inspectNativeRoot(options);
}
function parse(args, records) {
  const short = /^([a-z][a-z0-9-]*)(?:\s+--review\s+([a-z][a-z0-9-]*))?$/.exec(args.trim());
  if (short) {
    return { ...resolveValidatedTask(short[1], records), ...(short[2] ? { reviewTaskId: short[2] } : {}) };
  }
  const match = /^(?:"([^"\r\n]+)"|([^"\s]+))\s+([a-z][a-z0-9-]*)(?:\s+--review\s+([a-z][a-z0-9-]*))?$/.exec(args.trim());
  // Pasted newlines around/between arguments are whitespace, not extra commands.
  // Never join a split filename: that could silently select a different brief.
  if (!match || /\0/.test(args)) throw new Error('Use "brief.json" writer-task [--review review-task]. Whitespace between arguments is allowed; keep the filename unbroken and omit extra commands.');
  return { filename: match[1] ?? match[2], taskId: match[3], ...(match[4] ? { reviewTaskId: match[4] } : {}) };
}
export function registerIntegration(pi, records, inspect = integrationPreview, proveRoot = integrationNativeProof, inspectCheckout = checkout) {
  let busy = false, armed = null, stopped = false;
  const append = item => pi.appendEntry(ENTRY, { ...item, recordedAt: new Date().toISOString() });
  const latest = ctx => records(ctx).findLast(item => item.kind === 'integration-intent');
  const history = (ctx, intent) => records(ctx).filter(item => item.intentId === intent.intentId);
  const inspectHere = (params, ctx, ignoreAttempt = false) => inspect({ ...params, ignoreAttempt,
    filename: path.resolve(ctx.cwd, params.filename), cwd: ctx.cwd, records: records(ctx),
    entries: ctx.sessionManager.getBranch(), sessionFile: ctx.sessionManager.getSessionFile() });
  const native = (report, ctx) => proveRoot({ prepared: { root: report.current.root,
    ...(report.reviewTaskId ? { target: report.destination.root, repository: report.evidence.repository,
      planArguments: { worktreeCwd: report.destination.root } } : {}) }, sessionFile: ctx.sessionManager.getSessionFile(),
    ...nativeSessionOptions(pi, ctx), exec: pi.exec?.bind(pi), signal: ctx.signal });
  const ready = report => {
    if (report.state !== 'ready-for-native-approval' || !report.command || !report.fingerprint)
      throw new Error(report.blockers.join('; ') || 'No integration needed; inspect the next step separately.');
  };
  pi.registerTool?.({ name: 'forgeflow_integration_preview', label: 'Preview integration',
    description: 'Read-only writer-to-application or verified writer-to-review fast-forward preview. Requires current root validation for a new application merge. No Git mutation, native approval, verification save, preparation or dispatch.',
    parameters: { type: 'object', properties: { filename: { type: 'string' }, taskId: { type: 'string' }, reviewTaskId: { type: 'string' } }, required: ['filename', 'taskId'], additionalProperties: false },
    execute: async (_id, params, _signal, _update, ctx) => {
      if (Object.keys(params).some(key => !['filename', 'taskId', 'reviewTaskId'].includes(key)) ||
          typeof params.filename !== 'string' || /[\r\n\0"]/.test(params.filename) ||
          !/^[a-z][a-z0-9-]*$/.test(params.taskId ?? '') ||
          params.reviewTaskId !== undefined && !/^[a-z][a-z0-9-]*$/.test(params.reviewTaskId)) throw new Error('Invalid read-only integration request.');
      const report = await inspectHere(params, ctx);
      return { content: [{ type: 'text', text: renderIntegration(report) }], details: report };
    } });
  pi.registerCommand('forgeflow-integration-preview', { description: 'Preview one application or dependent-review fast-forward; never execute',
    handler: async (args, ctx) => {
      try { const report = await inspectHere(parse(args, records(ctx)), ctx);
        pi.sendMessage({ customType: 'forgeflow-integration-preview', content: renderIntegration(report), details: report, display: true }, { triggerTurn: false });
      } catch (error) { ctx.ui.notify(message(error), 'error'); }
    } });
  pi.registerCommand('forgeflow-integrate-once', { description: 'Hand off one exact fast-forward through native Bash and Baa-ton approval',
    handler: async (args, ctx) => {
      if (busy) { ctx.ui.notify('Integration inspection already in progress.', 'error'); return; }
      busy = true;
      try {
        if (!ctx.hasUI || !ctx.isIdle() || typeof ctx.ui.confirm !== 'function' || !pi.getActiveTools?.().includes('bash'))
          throw new Error('Use an idle interactive owning root with native Bash and confirmation UI.');
        const params = parse(args, records(ctx)), report = await inspectHere(params, ctx); ready(report);
        if (records(ctx).some(item => item.kind === 'integration-intent' && item.workflowId === report.workflowId && item.reviewTaskId === report.reviewTaskId))
          throw new Error('Integration was already handed off for this destination; inspect its audit. No retry.');
        const proof = await native(report, ctx);
        if (!await ctx.ui.confirm('Hand off this fast-forward?', `${renderIntegration(report)}\n\nRequest one native Bash invocation? Baa-ton must approve that invocation separately. No push, preparation, verification or next lane is authorized.`)) return;
        const fresh = await inspectHere(params, ctx); ready(fresh);
        if (fresh.fingerprint !== report.fingerprint || !isDeepStrictEqual(proof.readiness, (await native(fresh, ctx)).readiness))
          throw new Error('Integration evidence or root changed during confirmation.');
        const intent = { kind: 'integration-intent', intentId: randomUUID(), sourcePath: fresh.sourcePath,
          sourceSha256: fresh.sourceSha256, taskId: fresh.taskId, workflowId: fresh.workflowId,
          reviewTaskId: fresh.reviewTaskId, current: fresh.current, fingerprint: fresh.fingerprint,
          destination: fresh.destination, commit: fresh.evidence.commit, command: fresh.command, rootProof: proof.readiness };
        append(intent); armed = intent.intentId;
        pi.sendMessage({ customType: 'forgeflow-integration-handoff', display: true, details: intent,
          content: `Request the registered bash tool exactly once with ${JSON.stringify({ command: intent.command })}. Let Baa-ton perform its native fast-forward approval and fresh Git checks. If blocked or unavailable, stop without substitutions or retries. After the result report it and stop. No further Git commands, push, verification save, review preparation, dispatch or cleanup.` }, { triggerTurn: true });
      } catch (error) { armed = null; ctx.ui.notify(message(error), 'error'); }
      finally { busy = false; }
    } });
  pi.registerCommand('forgeflow-integration-audit', { description: 'Read integration handoff history in this session branch',
    handler: async (_args, ctx) => pi.sendMessage({ customType: 'forgeflow-integration-audit', display: true,
      content: JSON.stringify(records(ctx).filter(item => ['integration-intent', 'integration-attempt', 'integration-result', 'integration-blocked'].includes(item.kind)), null, 2) }, { triggerTurn: false }) });
  pi.on?.('tool_call', async (event, ctx) => {
    if (stopped) return { block: true, reason: 'Integration attempt finished; report and stop.' };
    const intent = latest(ctx); if (!intent) return;
    const items = history(ctx, intent);
    if (items.some(item => item.kind === 'integration-result')) {
      if (event.toolName === 'bash' && records(ctx).some(item => item.kind === 'integration-intent' && item.command === event.input?.command))
        return { block: true, reason: 'Recorded integration command is already consumed. No replay.' };
      return;
    }
    if (busy || armed !== intent.intentId || items.some(item => ['integration-attempt', 'integration-blocked'].includes(item.kind)) ||
        event.toolName !== 'bash' || !isDeepStrictEqual(event.input, { command: intent.command }))
      return { block: true, reason: 'Only the armed exact native integration call is allowed. Inspect uncertain history; no substitution or retry.' };
    busy = true;
    try {
      const fresh = await inspectHere({ filename: intent.sourcePath, taskId: intent.taskId, ...(intent.reviewTaskId ? { reviewTaskId: intent.reviewTaskId } : {}) }, ctx, true); ready(fresh);
      if (fresh.fingerprint !== intent.fingerprint || !isDeepStrictEqual(intent.rootProof, (await native(fresh, ctx)).readiness))
        throw new Error('Integration state changed after confirmation.');
      append({ ...intent, kind: 'integration-attempt', toolCallId: event.toolCallId }); armed = null;
    } catch (error) {
      armed = null;
      try { append({ ...intent, kind: 'integration-blocked', reason: message(error) }); } catch { stopped = true; }
      return { block: true, reason: message(error) };
    } finally { busy = false; }
  });
  pi.on?.('tool_result', async (event, ctx) => {
    const attempt = records(ctx).findLast(item => item.kind === 'integration-attempt' && item.toolCallId === event.toolCallId);
    if (!attempt || event.toolName !== 'bash' || history(ctx, attempt).some(item => item.kind === 'integration-result')) return;
    stopped = true; armed = null;
    let outcome = 'unknown', reason = 'Native result does not prove successful integration.';
    try {
      if (event.isError !== false) throw new Error('Native call failed or was blocked; inspect before any further action.');
      const after = await inspectCheckout(attempt.destination.root);
      if (after.root !== attempt.destination.root || after.head !== attempt.commit || after.branch !== attempt.destination.branch || after.commonDir !== attempt.destination.commonDir)
        throw new Error('Destination differs from the requested clean fast-forward result.');
      outcome = 'integrated'; reason = 'Destination is clean at the exact commit on the expected branch. Final verification/preparation remains separate.';
    } catch (error) { reason = message(error); }
    try { append({ ...attempt, kind: 'integration-result', outcome, reason, isError: event.isError !== false }); }
    catch (error) { ctx.ui.notify(`Integration audit could not be saved: ${message(error)}. Do not retry.`, 'error'); return; }
    ctx.ui.notify(`${outcome}: ${reason}`, 'info');
  });
  pi.on?.('agent_end', () => { stopped = false; armed = null; });
}
