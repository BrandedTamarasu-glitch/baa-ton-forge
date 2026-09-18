import { readFile, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readManifestSnapshot, assertSnapshotUnchanged } from './manifest-snapshot.js';
import { resolveManifestPath } from './manifest-path.js';

const PRE_PERSISTENCE_REJECTIONS = new Map([
  ['Only the verified controller-mapped root may create or update the parent goal or queue.', 'pre-persistence-root-rejection'],
  ['Herdr worktree list response is missing source_workspace_id.', 'pre-persistence-source-workspace-rejection'],
]);
const digest = value => createHash('sha256').update(value).digest('hex');

function unchangedObservedWorkflows(manifest, entries, index, started, sessionFile, env) {
  // Only this simple manifest shape is supported. Goals, queues, multi-root
  // state and unknown fields need a separate pre-submission baseline.
  if (Object.keys(manifest).some(key => !['version', 'workflows', 'sessionLog'].includes(key)) || !manifest.workflows.length)
    throw new Error('Newer manifest has unproven state beyond workflows and root activity');
  const log = manifest.sessionLog;
  if (!log || log.kind !== 'root' || log.paneId !== env.HERDR_PANE_ID || log.workspaceId !== env.HERDR_WORKSPACE_ID ||
      Object.keys(log).some(key => !['kind', 'sessionRef', 'startedAt', 'lastResponseAt', 'status', 'paneId', 'workspaceId'].includes(key)) ||
      Object.keys(log.sessionRef ?? {}).some(key => !['provider', 'sessionId', 'nativeHandle'].includes(key)) ||
      Object.keys(log.sessionRef?.nativeHandle ?? {}).some(key => !['kind', 'value'].includes(key)) ||
      log.sessionRef?.provider !== 'pi' || log.sessionRef?.sessionId !== sessionFile ||
      log.sessionRef?.nativeHandle?.kind !== 'path' || log.sessionRef?.nativeHandle?.value !== sessionFile)
    throw new Error('Newer manifest root activity does not match this native session');
  const prior = entries.slice(0, index);
  const knownIds = new Set(), observations = new Map();
  for (const entry of prior) {
    const msg = entry.message;
    if (entry.type !== 'message' || msg?.role !== 'toolResult' || msg.isError === true ||
        !['herdr_plan', 'herdr_observe'].includes(msg.toolName)) continue;
    const workflow = msg.details?.workflow;
    if (!workflow?.id) continue;
    const at = Date.parse(entry.timestamp);
    if (!Number.isFinite(at) || at >= started) throw new Error('Prior native workflow evidence has invalid timestamps');
    const calls = prior.slice(0, prior.indexOf(entry)).flatMap(candidate =>
      candidate.type === 'message' && candidate.message?.role === 'assistant'
        ? (candidate.message.content ?? []).filter(part => part.type === 'toolCall' && part.id === msg.toolCallId)
        : []);
    const results = entries.filter(candidate => candidate.type === 'message' && candidate.message?.role === 'toolResult' && candidate.message.toolCallId === msg.toolCallId);
    if (calls.length !== 1 || results.length !== 1 || calls[0].name !== msg.toolName)
      throw new Error('Prior workflow evidence lacks a unique matching native call/result');
    knownIds.add(workflow.id);
    if (msg.toolName === 'herdr_observe') {
      if (calls[0].arguments?.workflowId !== workflow.id) throw new Error('Prior observation workflow identity mismatch');
      observations.set(workflow.id, { entry, workflow });
    }
  }
  const currentIds = new Set(manifest.workflows.map(workflow => workflow.id));
  if (currentIds.size !== manifest.workflows.length || currentIds.size !== knownIds.size || [...knownIds].some(id => !currentIds.has(id)))
    throw new Error('Workflow inventory differs from pre-submission native history');
  return manifest.workflows.map(workflow => {
    const saved = observations.get(workflow.id);
    if (!saved || !isDeepStrictEqual(saved.workflow, workflow))
      throw new Error(`Workflow ${workflow.id} differs from its pre-submission native observation`);
    return { workflowId: workflow.id, observationEntryId: saved.entry.id, observationSha256: digest(JSON.stringify(saved.entry)) };
  });
}

export function submissionRecovered(record, records) {
  return record.kind === 'planning' && records.some(item =>
    item.kind === 'submission-no-effect' && item.toolCallId === record.toolCallId &&
    item.root === record.root && item.taskId === record.taskId &&
    item.sourcePath === record.sourcePath && item.sourceSha256 === record.sourceSha256);
}

// Deliberately narrow recovery: these exact root-authorization and source
// workspace rejections occur before plan persistence. Read evidence from the real session branch,
// never from caller-supplied error text. Newer manifests require exact earlier
// native workflow snapshots; absence of a matching workflow alone is not proof.
export async function recoverSubmission({ filename, taskId, cwd, entries, sessionFile, env = process.env }) {
  const root = await realpath(cwd);
  if (env.HERDR_ENV !== '1' || !env.HERDR_PANE_ID || !env.HERDR_WORKSPACE_ID || !sessionFile)
    throw new Error('Recovery requires a real Herdr pane and native Pi session');
  const sourcePath = path.resolve(cwd, filename);
  const custom = entries.filter(entry => entry.type === 'custom' && entry.customType === 'forgeflow-adapter');
  const planning = custom.findLast(entry => entry.data.kind === 'planning' && entry.data.root === root && entry.data.sourcePath === sourcePath && entry.data.taskId === taskId);
  if (!planning) throw new Error('No saved planning attempt for this task in the current session branch');
  const record = planning.data;
  if (record.sessionFile && record.sessionFile !== sessionFile) throw new Error('Failed attempt belongs to another Pi session');
  if (record.paneId !== env.HERDR_PANE_ID || record.workspaceId !== env.HERDR_WORKSPACE_ID)
    throw new Error('Failed attempt belongs to another pane or workspace');
  const prior = custom.find(entry => entry.data.kind === 'submission-no-effect' && entry.data.toolCallId === record.toolCallId && entry.data.root === root && entry.data.sourcePath === sourcePath && entry.data.taskId === taskId);
  if (prior) return prior.data;
  if (custom.some(entry => entry.data.kind === 'planned' && entry.data.root === root && entry.data.taskId === taskId && entry.data.sourcePath === sourcePath && entry.data.sourceSha256 === record.sourceSha256))
    throw new Error('A durable mapping exists; use workflow reconciliation');
  const index = entries.indexOf(planning);
  const call = entries.slice(0, index).findLast(entry => entry.type === 'message' && entry.message?.role === 'assistant' && entry.message.content?.some(part => part.type === 'toolCall' && part.id === record.toolCallId));
  const toolCall = call?.message.content.find(part => part.type === 'toolCall' && part.id === record.toolCallId);
  const results = entries.slice(index + 1).filter(entry => entry.type === 'message' && entry.message?.role === 'toolResult' && entry.message.toolCallId === record.toolCallId);
  if (toolCall?.name !== 'herdr_plan' || !isDeepStrictEqual(toolCall.arguments, record.planArguments) || results.length !== 1)
    throw new Error('Matching native herdr_plan call and unique result are required');
  const result = results[0];
  const error = result.message.content?.filter(part => part.type === 'text').map(part => part.text).join('\n').trim().replace(/^Error: /, '');
  const reason = PRE_PERSISTENCE_REJECTIONS.get(error);
  if (result.message.toolName !== 'herdr_plan' || result.message.isError !== true || !reason)
    throw new Error('Only an exact supported pre-persistence root-authorization or missing-source-workspace rejection can be recovered');
  if (reason === 'pre-persistence-source-workspace-rejection' &&
      (typeof record.planArguments.worktreeCwd !== 'string' || !path.isAbsolute(record.planArguments.worktreeCwd)))
    throw new Error('Missing-source-workspace recovery requires an explicit absolute worktreeCwd in the saved plan');
  const started = Date.parse(planning.timestamp);
  if (!Number.isFinite(started) || !(Date.parse(result.timestamp) >= started)) throw new Error('Saved submission timestamps are invalid');
  if (record.manifestSnapshot) {
    const owner = { paneId: record.paneId, workspaceId: record.workspaceId, sessionFile };
    const { snapshot, manifest } = await readManifestSnapshot(root, owner, env);
    assertSnapshotUnchanged(record.manifestSnapshot, snapshot, started, owner);
    if (manifest?.workflows.some(workflow => workflow.objective === record.planArguments.objective))
      throw new Error('A matching durable workflow exists; reconcile it instead');
    return { ...record, kind: 'submission-no-effect', recoveredAt: new Date().toISOString(), sessionFile,
      evidence: { reason, planningEntryId: planning.id, resultEntryId: result.id,
        resultSha256: digest(JSON.stringify(result)), manifestPath: snapshot.path,
        manifestProof: 'saved-pre-submission-snapshot', before: record.manifestSnapshot, after: snapshot } };
  }
  const manifestPath = await resolveManifestPath(root, { env });
  const before = await lstat(manifestPath);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Manifest must be a regular non-symlink file');
  const bytes = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(bytes);
  if (![1, 2].includes(manifest.version) || !Array.isArray(manifest.workflows)) throw new Error('Invalid durable manifest');
  if (manifest.workflows.some(workflow => workflow.objective === record.planArguments.objective)) throw new Error('A matching durable workflow exists; reconcile it instead');
  let observations;
  if (before.mtimeMs >= started || before.ctimeMs >= started) {
    try { observations = unchangedObservedWorkflows(manifest, entries, index, started, sessionFile, env); }
    catch (error) { throw new Error(`Manifest changed since submission without sufficient native baseline evidence: ${error.message}`); }
  }
  const after = await lstat(manifestPath);
  if (before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size)
    throw new Error('Manifest changed during recovery');
  return { ...record, kind: 'submission-no-effect', recoveredAt: new Date().toISOString(), sessionFile,
    evidence: { reason, planningEntryId: planning.id, resultEntryId: result.id,
      resultSha256: digest(JSON.stringify(result)), manifestPath, manifestSha256: digest(bytes), manifestMtime: before.mtime.toISOString(),
      manifestProof: observations ? 'exact-pre-submission-native-observations' : 'pre-submission-file-timestamps',
      ...(observations ? { observations } : {}) } };
}
