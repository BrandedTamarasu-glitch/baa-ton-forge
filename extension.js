import path from 'node:path';
import { loadPreview, renderPreview } from './planner.js';
import { prepareLane, revalidate, matchPlan, verifyLane, reconcileLane } from './prepare.js';

const ENTRY = 'forgeflow-adapter';
const message = error => error instanceof Error ? error.message : String(error);
function records(ctx) {
  return (ctx.sessionManager?.getBranch?.() ?? []).filter(entry => entry.type === 'custom' && entry.customType === ENTRY).map(entry => entry.data);
}
function splitTask(args) {
  const match = args.trim().match(/^(.*?)\s+([a-z][a-z0-9-]*)$/);
  if (!match) throw new Error('Usage: /forgeflow-prepare-lane "path/to/brief.md" task-id');
  return { filename: match[1].replace(/^"(.*)"$/, '$1'), taskId: match[2] };
}

export default function adapter(pi) {
  const pending = new Map();
  pi.registerCommand('forgeflow-plan-lanes', {
    description: 'Preview Baa-ton lanes from a Forgeflow brief; never dispatch',
    handler: async (args, ctx) => {
      try {
        let filename = args.trim();
        if (filename.startsWith('"') && filename.endsWith('"')) filename = filename.slice(1, -1);
        if (!filename) throw new Error('Usage: /forgeflow-plan-lanes path/to/brief.md');
        const preview = await loadPreview(path.resolve(ctx.cwd, filename));
        pi.appendEntry?.(ENTRY, { kind: 'preview', sourcePath: preview.sourcePath, sourceSha256: preview.sourceSha256 });
        pi.sendMessage({ customType: 'forgeflow-lane-preview', content: renderPreview(preview), display: true, details: preview }, { triggerTurn: false });
      } catch (error) {
        ctx.ui.notify(message(error), 'error');
      }
    },
  });
  pi.registerCommand('forgeflow-prepare-lane', {
    description: 'Check a preview lane and display a root planning handoff',
    handler: async (args, ctx) => {
      try {
        const { filename, taskId } = splitTask(args);
        const resolved = path.resolve(ctx.cwd, filename);
        const history = records(ctx);
        const preview = history.findLast(item => item.kind === 'preview' && item.sourcePath === resolved);
        const prepared = await prepareLane({ filename: resolved, taskId, preview, cwd: ctx.cwd, records: history });
        pi.appendEntry(ENTRY, prepared);
        pi.sendMessage({ customType: 'forgeflow-lane-handoff', display: true, details: prepared, content: `Prepared ${taskId} at ${prepared.targetHead}.\nRoot must verify Baa-ton readiness and call herdr_plan with these exact arguments. Dispatch remains a separate explicit action.\n\n${JSON.stringify(prepared.planArguments, null, 2)}` }, { triggerTurn: false });
      } catch (error) { ctx.ui.notify(message(error), 'error'); }
    },
  });
  pi.registerCommand('forgeflow-verify-lane', {
    description: 'Record root verification after durable completion and integration',
    handler: async (args, ctx) => {
      try {
        const match = args.trim().match(/^(\S+)\s+([0-9a-f]{40,64})\s+([\s\S]+)$/);
        if (!match) throw new Error('Usage: /forgeflow-verify-lane workflow-id full-commit-hash checks-and-results');
        const mapped = records(ctx).findLast(item => item.kind === 'planned' && item.workflowId === match[1]);
        if (!mapped) throw new Error('Workflow is not mapped in this root session; use /forgeflow-reconcile-lane with the original brief, task ID, and workflow ID');
        const verified = await verifyLane({ mapped, commit: match[2], evidence: match[3], cwd: ctx.cwd });
        pi.appendEntry(ENTRY, verified);
        ctx.ui.notify(`Recorded root verification for ${mapped.taskId}`, 'info');
      } catch (error) { ctx.ui.notify(message(error), 'error'); }
    },
  });
  pi.registerCommand('forgeflow-reconcile-lane', {
    description: 'Recover a missing workflow mapping from the matching durable manifest',
    handler: async (args, ctx) => {
      try {
        const match = args.trim().match(/^(.*?)\s+([a-z][a-z0-9-]*)\s+(herdr-[a-z0-9-]+)$/);
        if (!match) throw new Error('Usage: /forgeflow-reconcile-lane "path/to/brief.md" task-id workflow-id');
        const mapped = await reconcileLane({ filename: path.resolve(ctx.cwd, match[1].replace(/^"(.*)"$/, '$1')), taskId: match[2], workflowId: match[3], cwd: ctx.cwd, sessionFile: ctx.sessionManager.getSessionFile() });
        const previous = records(ctx).filter(item => item.kind === 'planned' && (item.workflowId === mapped.workflowId || (item.root === mapped.root && item.sourcePath === mapped.sourcePath && item.taskId === mapped.taskId)));
        if (previous.some(item => item.workflowId !== mapped.workflowId || item.taskId !== mapped.taskId || item.sourceSha256 !== mapped.sourceSha256 || item.sourcePath !== mapped.sourcePath)) throw new Error('Conflicting session mapping already exists; inspect it before reconciliation');
        if (!previous.length) pi.appendEntry(ENTRY, mapped);
        ctx.ui.notify(`Mapping confirmed: ${mapped.taskId} → ${mapped.workflowId}. Verification remains separate.`, 'info');
      } catch (error) { ctx.ui.notify(message(error), 'error'); }
    },
  });
  pi.on?.('tool_call', async (event, ctx) => {
    if (event.toolName !== 'herdr_plan') return;
    const history = records(ctx);
    const prepared = history.findLast(item => item.kind === 'prepared' && item.planArguments.objective === event.input.objective);
    if (!prepared) return;
    try {
      if (!matchPlan(prepared, event)) throw new Error('Arguments differ from the prepared lane; prepare again');
      if (path.resolve(ctx.cwd) !== prepared.root) throw new Error('Root directory changed since prepare');
      if (pending.size) throw new Error('Another prepared plan is in flight; wait for its result');
      pending.set(event.toolCallId, prepared);
      await revalidate(prepared, history);
      pi.appendEntry(ENTRY, { ...prepared, kind: 'planning', toolCallId: event.toolCallId });
    } catch (error) { pending.delete(event.toolCallId); return { block: true, reason: message(error) }; }
  });
  pi.on?.('tool_result', (event, ctx) => {
    const prepared = pending.get(event.toolCallId);
    if (!prepared) {
      if (event.toolName === 'herdr_plan' && !event.isError && event.details?.workflow?.id) ctx.ui.notify('Native plan has no adapter mapping. Use /forgeflow-reconcile-lane if this plan belongs to an adapter brief. Run adapter slash commands directly in Pi, not through shell imports.', 'warning');
      return;
    }
    pending.delete(event.toolCallId);
    const workflow = event.details?.workflow;
    if (event.isError || !workflow?.id || workflow.cwd !== prepared.target) {
      ctx.ui.notify('Plan was not mapped: inspect the Baa-ton result before retrying', 'warning');
      return;
    }
    pi.appendEntry(ENTRY, { ...prepared, kind: 'planned', workflowId: workflow.id });
    ctx.ui.notify(`Mapped ${prepared.taskId} to ${workflow.id}`, 'info');
  });
}
