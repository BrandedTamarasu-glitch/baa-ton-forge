import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { loadPreview, renderPreview } from './planner.js';
import { prepareLane, revalidate, matchPlan, verifyLane, reconcileLane } from './prepare.js';
import { laneStatus, renderStatus } from './status.js';
import { continuationPreview, renderContinuation } from './continuation.js';
import { checkContinuation } from './continuation-readiness.js';
import { registerDispatchOnce } from './dispatch-once.js';
import { recoverSubmission } from './recovery.js';
import { nativePreflight } from './preflight.js';
import { readManifestSnapshot } from './manifest-snapshot.js';
import { isDeepStrictEqual } from 'node:util';

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
function renderHandoff(prepared) {
  return `Prepared ${prepared.taskId} at ${prepared.targetHead}.\nNative root/session and required source-workspace checks passed and will be rechecked before submission. Baa-ton remains authoritative for authorization and dispatch readiness. Dispatch remains a separate explicit action.\n\n${JSON.stringify(prepared.planArguments, null, 2)}`;
}

export default function adapter(pi) {
  if (pi.on) registerDispatchOnce(pi, records);
  const pending = new Map();
  async function recover(params, ctx) {
    if (pending.size) throw new Error('A plan is still in flight; wait for its result');
    const record = await recoverSubmission({ ...params, cwd: ctx.cwd, entries: ctx.sessionManager.getBranch(), sessionFile: ctx.sessionManager.getSessionFile() });
    if (!records(ctx).some(item => item.kind === record.kind && item.toolCallId === record.toolCallId)) pi.appendEntry(ENTRY, record);
    return record;
  }
  async function preview(params, ctx) {
    const result = await loadPreview(path.resolve(ctx.cwd, params.filename), { cwd: ctx.cwd });
    pi.appendEntry(ENTRY, { kind: 'preview', sourcePath: result.sourcePath, sourceSha256: result.sourceSha256 });
    return result;
  }
  async function prepare(params, ctx, signal = ctx.signal) {
    const filename = path.resolve(ctx.cwd, params.filename);
    const history = records(ctx);
    const previous = history.findLast(item => item.kind === 'preview' && item.sourcePath === filename);
    const prepared = await prepareLane({ filename, taskId: params.taskId, preview: previous, cwd: ctx.cwd, records: history });
    const sessionFile = ctx.sessionManager.getSessionFile();
    const nativeReadiness = await nativePreflight({ prepared, sessionFile, exec: pi.exec?.bind(pi), signal, ensureSource: params.createSourceWorkspace !== false });
    await revalidate(prepared, history);
    const record = { ...prepared, sessionFile, nativeReadiness };
    pi.appendEntry(ENTRY, record);
    return record;
  }
  async function status(params, ctx) {
    return laneStatus({ filename: path.resolve(ctx.cwd, params.filename), cwd: ctx.cwd, records: records(ctx), sessionFile: ctx.sessionManager.getSessionFile() });
  }
  async function continuePreview(params, ctx) {
    if (Object.keys(params).some(key => key !== 'filename')) throw new Error('Continuation supports preview only; only filename is accepted');
    return continuationPreview(await status(params, ctx));
  }
  async function readiness(params, ctx, signal) {
    if (Object.keys(params).some(key => key !== 'filename')) throw new Error('Readiness is read-only; only filename is accepted');
    return checkContinuation({ filename: path.resolve(ctx.cwd, params.filename), cwd: ctx.cwd, records: records(ctx), sessionFile: ctx.sessionManager.getSessionFile(), exec: pi.exec?.bind(pi), signal });
  }
  async function reconcile(params, ctx) {
    const mapped = await reconcileLane({ filename: path.resolve(ctx.cwd, params.filename), taskId: params.taskId, workflowId: params.workflowId, cwd: ctx.cwd, sessionFile: ctx.sessionManager.getSessionFile() });
    const previous = records(ctx).filter(item => item.kind === 'planned' && (item.workflowId === mapped.workflowId || (item.root === mapped.root && item.sourcePath === mapped.sourcePath && item.taskId === mapped.taskId)));
    if (previous.some(item => item.workflowId !== mapped.workflowId || item.taskId !== mapped.taskId || item.sourceSha256 !== mapped.sourceSha256 || item.sourcePath !== mapped.sourcePath)) throw new Error('Conflicting session mapping already exists; inspect it before reconciliation');
    if (!previous.length) pi.appendEntry(ENTRY, mapped);
    return mapped;
  }
  async function verify(params, ctx) {
    const mapped = records(ctx).findLast(item => item.kind === 'planned' && item.workflowId === params.workflowId);
    if (!mapped) throw new Error('Workflow is not mapped in this root session; use forgeflow_reconcile_lane with the original brief, task ID, and workflow ID');
    const verified = await verifyLane({ mapped, commit: params.commit, evidence: params.evidence, cwd: ctx.cwd });
    pi.appendEntry(ENTRY, verified);
    return verified;
  }
  for (const definition of [
    { name: 'forgeflow_check_readiness', label: 'Check continuation prerequisites', fields: ['filename'], run: readiness, render: renderContinuation, description: 'Read-only native continuation prerequisite inspection. Checks clean checkout, dependency integration, exact saved profile and registered root/session/source binding for the selected prepare/plan/dispatch-review step. Never creates a workspace or invokes planning/dispatch. Does not establish authorization, model entitlement or runtime qualification; Baa-ton remains authoritative for dispatch.' },
    { name: 'forgeflow_continue', label: 'Preview root continuation', fields: ['filename'], run: continuePreview, render: renderContinuation, description: 'Preview only: explain one immediate next root step from local status evidence, required checks and stop reasons. Execution is not supported. Does not invoke suggested tools, save records, prepare, plan, dispatch, approve, verify or create resources. Authorization and native readiness are not assessed. Baa-ton owns future planning and dispatch; root verification remains independent.' },
    { name: 'forgeflow_recover_submission', label: 'Reconcile rejected submission', fields: ['filename', 'taskId'], run: recover, render: record => `Saved no-durable-effect evidence for ${record.taskId}, attempt ${record.toolCallId}. History retained. Run preview and prepare again after the reported planning prerequisite is repaired.`, description: 'Recover only an exact saved pre-persistence herdr_plan root-authorization or missing-source-workspace rejection in this native Pi session. Requires the matching call/result and an unchanged saved pre-submission manifest fingerprint; legacy attempts require an older manifest or exact earlier native workflow observations; fails closed for ambiguous effects. Appends evidence without deleting history, changing the brief, registering roots, planning or dispatching. Run before root migration or other operations change the manifest.' },
    { name: 'forgeflow_status', label: 'Show workflow status', fields: ['filename'], run: status, render: renderStatus, description: 'Read-only status and next-action advice for a brief: current root/session, owning pane/workspace, workflow IDs, durable receipts and delivery, saved verification, parent requests and preparation blockers. Reads this checkout manifest, local Git evidence and current session branch. Does not establish authorization or live native readiness, scan other projects, save records, run tests, prepare or dispatch. Completed receipts should be independently verified even if notification delivery is pending.' },
    { name: 'forgeflow_plan_lanes', label: 'Preview workflow lanes', fields: ['filename'], run: preview, render: renderPreview, description: 'Preview a structured Forgeflow brief and save its hash in this live Pi session. Returns lane scopes, dependencies, blockers and proposed planning arguments. Does not call Baa-ton, create worktrees, run checks or dispatch. Use this tool before forgeflow_prepare_lane; shell imports do not save session records.' },
    { name: 'forgeflow_prepare_lane', label: 'Prepare workflow lane', fields: ['filename', 'taskId'], run: prepare, render: renderHandoff, description: 'Validate a previewed brief and persist a checked handoff. For explicit repoCwd tasks, automatically reuse a valid source workspace or create an unfocused shell-only workspace through Herdr when missing; no agent or second root is launched. Set createSourceWorkspace=false for checks without resource creation. Requires registered root/session ownership, clean linked target and verified integrated dependencies. Creation is audited in repository Git metadata and serialized; ambiguous outcomes stop without automatic creation retries. Returns exact herdr_plan arguments; does not plan, dispatch, close resources or change root registrations.' },
    { name: 'forgeflow_reconcile_lane', label: 'Reconcile workflow mapping', fields: ['filename', 'taskId', 'workflowId'], run: reconcile, description: 'Persist a missing adapter mapping in this live Pi session after validating the durable Baa-ton workflow against the brief and root identity. Use this native tool, not shell imports of prepare.js; shell calls cannot save Pi session records. Does not dispatch or mark verified.' },
    { name: 'forgeflow_verify_lane', label: 'Record root verification', fields: ['workflowId', 'commit', 'evidence'], run: verify, description: 'Persist root verification in this live Pi session after independently checking the lane. Requires a mapped workflow, durable completion receipt, clean lane at the full commit hash, and integration into the declared repository checkout (the root by default). Evidence must describe checks actually rerun and their results. Use this native tool rather than shell imports.' },
  ]) {
    pi.registerTool?.({
      name: definition.name, label: definition.label, description: definition.description,
      parameters: { type: 'object', properties: { ...Object.fromEntries(definition.fields.map(field => [field, { type: 'string', minLength: 1 }])), ...(definition.name === 'forgeflow_prepare_lane' ? { createSourceWorkspace: { type: 'boolean', description: 'Allow automatic source-workspace creation for explicit repoCwd tasks (default true). False performs read-only native checks.' } } : {}) }, required: definition.fields, additionalProperties: false },
      execute: async (_id, params, _signal, _update, ctx) => {
        const record = await definition.run(params, ctx, _signal);
        return { content: [{ type: 'text', text: definition.render ? definition.render(record) : `Saved ${record.kind} record for ${record.taskId} (${record.workflowId}) in this Pi session.` }], details: record };
      },
    });
  }
  pi.registerCommand('forgeflow-status', {
    description: 'Read-only task, workflow, verification, root status and next-action advice for a brief',
    handler: async (args, ctx) => {
      try {
        const filename = args.trim().replace(/^"(.*)"$/, '$1');
        if (!filename) throw new Error('Usage: /forgeflow-status "path/to/brief.md"');
        const result = await status({ filename }, ctx);
        pi.sendMessage({ customType: 'forgeflow-status', content: renderStatus(result), display: true, details: result }, { triggerTurn: false });
      } catch (error) { ctx.ui.notify(message(error), 'error'); }
    },
  });
  pi.registerCommand('forgeflow-continue', {
    description: 'Preview the next root step and stop; never execute',
    handler: async (args, ctx) => {
      try {
        const filename = args.trim().replace(/^"(.*)"$/, '$1');
        if (!filename) throw new Error('Usage: /forgeflow-continue "path/to/brief.md" (preview only)');
        const result = await continuePreview({ filename }, ctx);
        pi.sendMessage({ customType: 'forgeflow-continuation-preview', content: renderContinuation(result), display: true, details: result }, { triggerTurn: false });
      } catch (error) { ctx.ui.notify(message(error), 'error'); }
    },
  });
  pi.registerCommand('forgeflow-check-readiness', {
    description: 'Inspect continuation prerequisites with read-only native probes',
    handler: async (args, ctx) => {
      try {
        const filename = args.trim().replace(/^"(.*)"$/, '$1');
        if (!filename) throw new Error('Usage: /forgeflow-check-readiness "path/to/brief.md"');
        const result = await readiness({ filename }, ctx, ctx.signal);
        pi.sendMessage({ customType: 'forgeflow-continuation-readiness', content: renderContinuation(result), display: true, details: result }, { triggerTurn: false });
      } catch (error) { ctx.ui.notify(message(error), 'error'); }
    },
  });
  pi.registerCommand('forgeflow-plan-lanes', {
    description: 'Preview Baa-ton lanes from a Forgeflow brief; never dispatch',
    handler: async (args, ctx) => {
      try {
        let filename = args.trim();
        if (filename.startsWith('"') && filename.endsWith('"')) filename = filename.slice(1, -1);
        if (!filename) throw new Error('Usage: /forgeflow-plan-lanes path/to/brief.md');
        const result = await preview({ filename }, ctx);
        pi.sendMessage({ customType: 'forgeflow-lane-preview', content: renderPreview(result), display: true, details: result }, { triggerTurn: false });
      } catch (error) {
        ctx.ui.notify(message(error), 'error');
      }
    },
  });
  pi.registerCommand('forgeflow-prepare-lane', {
    description: 'Prepare a preview lane, establishing a missing repoCwd source workspace if needed',
    handler: async (args, ctx) => {
      try {
        const { filename, taskId } = splitTask(args);
        const prepared = await prepare({ filename, taskId }, ctx);
        pi.sendMessage({ customType: 'forgeflow-lane-handoff', display: true, details: prepared, content: renderHandoff(prepared) }, { triggerTurn: false });
      } catch (error) { ctx.ui.notify(message(error), 'error'); }
    },
  });
  pi.registerCommand('forgeflow-verify-lane', {
    description: 'Record root verification after durable completion and integration',
    handler: async (args, ctx) => {
      try {
        const match = args.trim().match(/^(\S+)\s+([0-9a-f]{40,64})\s+([\s\S]+)$/);
        if (!match) throw new Error('Usage: /forgeflow-verify-lane workflow-id full-commit-hash checks-and-results');
        const verified = await verify({ workflowId: match[1], commit: match[2], evidence: match[3] }, ctx);
        ctx.ui.notify(`Recorded root verification for ${verified.taskId}`, 'info');
      } catch (error) { ctx.ui.notify(message(error), 'error'); }
    },
  });
  pi.registerCommand('forgeflow-reconcile-lane', {
    description: 'Recover a missing workflow mapping from the matching durable manifest',
    handler: async (args, ctx) => {
      try {
        const match = args.trim().match(/^(.*?)\s+([a-z][a-z0-9-]*)\s+(herdr-[a-z0-9-]+)$/);
        if (!match) throw new Error('Usage: /forgeflow-reconcile-lane "path/to/brief.md" task-id workflow-id');
        const mapped = await reconcile({ filename: match[1].replace(/^"(.*)"$/, '$1'), taskId: match[2], workflowId: match[3] }, ctx);
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
      if (history.slice(history.lastIndexOf(prepared) + 1).some(item => item.kind === 'submission-no-effect' && item.root === prepared.root && item.taskId === prepared.taskId && item.sourcePath === prepared.sourcePath && item.sourceSha256 === prepared.sourceSha256)) throw new Error('Submission was recovered; prepare the lane again before planning');
      if (!matchPlan(prepared, event)) throw new Error('Arguments differ from the prepared lane; prepare again');
      if (await realpath(ctx.cwd) !== prepared.root) throw new Error('Root directory changed since prepare');
      if (pending.size) throw new Error('Another prepared plan is in flight; wait for its result');
      pending.set(event.toolCallId, prepared);
      const { nativeReadiness, sessionFile, ...localPrepared } = prepared;
      await revalidate(localPrepared, history);
      if (!nativeReadiness) throw new Error('Preparation predates native preflight; prepare the lane again');
      if (sessionFile !== ctx.sessionManager.getSessionFile()) throw new Error('Root session changed since prepare; resume the owning session');
      const fresh = await nativePreflight({ prepared, sessionFile, exec: pi.exec?.bind(pi), signal: ctx.signal });
      if (!isDeepStrictEqual(fresh, nativeReadiness)) throw new Error('Native root or source binding changed since prepare; prepare the lane again');
      const owner = { paneId: prepared.paneId, workspaceId: prepared.workspaceId, sessionFile };
      const { snapshot: manifestSnapshot } = await readManifestSnapshot(prepared.root, owner);
      pi.appendEntry(ENTRY, { ...prepared, kind: 'planning', toolCallId: event.toolCallId, manifestSnapshot });
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
