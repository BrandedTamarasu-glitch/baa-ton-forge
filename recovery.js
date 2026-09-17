import { readFile, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const ROOT_REJECTION = 'Only the verified controller-mapped root may create or update the parent goal or queue.';
const digest = value => createHash('sha256').update(value).digest('hex');

export function submissionRecovered(record, records) {
  return record.kind === 'planning' && records.some(item =>
    item.kind === 'submission-no-effect' && item.toolCallId === record.toolCallId &&
    item.root === record.root && item.taskId === record.taskId &&
    item.sourcePath === record.sourcePath && item.sourceSha256 === record.sourceSha256);
}

// Deliberately narrow legacy recovery: this exact root-authorization rejection
// occurs before plan persistence. Read evidence from the real session branch,
// never from caller-supplied error text. A newer manifest is ambiguous and fails
// closed, even when it contains no matching workflow.
export async function recoverSubmission({ filename, taskId, cwd, entries, sessionFile, env = process.env }) {
  const root = await realpath(cwd);
  if (env.HERDR_ENV !== '1' || !env.HERDR_PANE_ID || !env.HERDR_WORKSPACE_ID || !sessionFile)
    throw new Error('Recovery requires a real Herdr pane and native Pi session');
  const sourcePath = path.resolve(cwd, filename);
  const custom = entries.filter(entry => entry.type === 'custom' && entry.customType === 'forgeflow-adapter');
  const planning = custom.findLast(entry => entry.data.kind === 'planning' && entry.data.root === root && entry.data.sourcePath === sourcePath && entry.data.taskId === taskId);
  if (!planning) throw new Error('No saved planning attempt for this task in the current session branch');
  const record = planning.data;
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
  if (result.message.toolName !== 'herdr_plan' || result.message.isError !== true || error !== ROOT_REJECTION)
    throw new Error('Only the exact pre-persistence root-authorization rejection can be recovered');
  const started = Date.parse(planning.timestamp);
  if (!Number.isFinite(started) || !(Date.parse(result.timestamp) >= started)) throw new Error('Saved submission timestamps are invalid');
  const manifestPath = path.join(root, '.pi/herdr-orchestrator/manifest.json');
  const before = await lstat(manifestPath);
  if (!before.isFile() || before.isSymbolicLink() || before.mtimeMs >= started || before.ctimeMs >= started)
    throw new Error('Manifest changed since submission or has no trustworthy pre-submission timestamp; manual investigation required');
  const bytes = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(bytes);
  if (![1, 2].includes(manifest.version) || !Array.isArray(manifest.workflows)) throw new Error('Invalid durable manifest');
  if (manifest.workflows.some(workflow => workflow.objective === record.planArguments.objective)) throw new Error('A matching durable workflow exists; reconcile it instead');
  const after = await lstat(manifestPath);
  if (before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size)
    throw new Error('Manifest changed during recovery');
  return { ...record, kind: 'submission-no-effect', recoveredAt: new Date().toISOString(), sessionFile,
    evidence: { reason: 'pre-persistence-root-rejection', planningEntryId: planning.id, resultEntryId: result.id,
      resultSha256: digest(JSON.stringify(result)), manifestPath, manifestSha256: digest(bytes), manifestMtime: before.mtime.toISOString() } };
}
