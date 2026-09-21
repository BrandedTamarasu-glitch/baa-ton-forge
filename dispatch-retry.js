import path from 'node:path';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';
import { inspectLanePrerequisites } from './prepare.js';
import { nativePreflight } from './preflight.js';
import { resolveManifestPath } from './manifest-path.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require = (condition, text) => { if (!condition) throw new Error(text); };
async function proofFile(filename, directory) {
  const info = await lstat(filename);
  require(info.isFile() && !info.isSymbolicLink() && info.size <= 256 * 1024 &&
    path.dirname(await realpath(filename)) === await realpath(directory), 'Startup proof must be a bounded regular file in the selected manifest directory');
  const bytes = await readFile(filename);
  return { value: JSON.parse(bytes), hash: hash(bytes) };
}

// Deliberately narrow: one Claude child already started, no prompt attempted,
// original startup proof intact. Baa-ton remains the final runtime authority.
export async function checkStartupRetry(options) {
  const { previous, records, cwd, sessionFile, exec, signal, env = process.env } = options;
  require(previous && previous.workflowId && previous.sourcePath === path.resolve(options.filename) &&
    previous.root === await realpath(cwd) && previous.sessionFile === sessionFile &&
    previous.paneId === env.HERDR_PANE_ID && previous.workspaceId === env.HERDR_WORKSPACE_ID,
  'Retry requires the original owning root, pane, session and brief');
  const results = records.filter(item => item.kind === 'dispatch-result' && item.intentId === previous.intentId);
  const attempts = records.filter(item => item.kind === 'dispatch-attempt' && item.intentId === previous.intentId);
  require(results.length === 1 && attempts.length === 1 && results[0].toolCallId === attempts[0].toolCallId &&
    results[0].outcome === 'error' && results[0].isError === true && /\bagent_not_ready\b/.test(results[0].resultText ?? ''),
  'Retry requires one saved agent_not_ready result for the consumed native attempt; uncertain outcomes remain blocked');
  const mapped = records.findLast(item => item.kind === 'planned' && item.workflowId === previous.workflowId);
  require(mapped && mapped.taskId === previous.taskId && mapped.sourcePath === previous.sourcePath &&
    mapped.sourceSha256 === previous.sourceSha256 && mapped.root === previous.root && mapped.sessionFile === sessionFile,
  'Retry has no matching original workflow mapping');
  const preview = records.findLast(item => item.kind === 'preview' && item.sourcePath === previous.sourcePath);
  const input = { ...options, taskId: previous.taskId, preview };
  const prepared = await inspectLanePrerequisites(input);
  const saved = records.findLast(item => item.kind === 'prepared' && item.taskId === previous.taskId &&
    item.sourcePath === previous.sourcePath && item.sourceSha256 === previous.sourceSha256);
  require(saved, 'Original preparation is unavailable');
  const { nativeReadiness, sessionFile: originalSession, ...local } = saved;
  require(originalSession === sessionFile && same(local, prepared), 'Checkout, profile or preparation changed since the original dispatch');
  const manifestPath = await resolveManifestPath(prepared.root, { env });
  const before = await readFile(manifestPath);
  const matches = JSON.parse(before).workflows?.filter(item => item.id === previous.workflowId);
  require(matches?.length === 1, 'Expected exactly one existing workflow');
  const workflow = matches[0], lane = workflow.lanes?.[0];
  require(['dispatch-failed', 'blocked', 'unknown'].includes(workflow.status) &&
    workflow.retry?.state === 'retryable' && workflow.retry.failedStage === 'agent-start' &&
    /\bagent_not_ready\b/.test(workflow.retry.error ?? '') && workflow.lanes?.length === 1 &&
    lane.agentKind === 'claude' && lane.agentStartAttemptedAt && lane.paneId && lane.tabId &&
    lane.incarnationId && lane.startupNonce && lane.startupIntentPath && lane.agentSessionPath &&
    !lane.promptAttemptedAt && !lane.promptedAt && !lane.completionReceipt && !workflow.dispatchedAt,
  'Only an unprompted, retryable single-Claude agent_not_ready startup can be retried');
  const binding = workflow.taskBinding, expected = prepared.planArguments.lanes[0];
  require(binding?.rootPaneId === previous.paneId && binding.workspaceId === previous.workspaceId &&
    binding.rootSessionPath === sessionFile && workflow.cwd === prepared.target &&
    workflow.objective === prepared.planArguments.objective && lane.objective === expected.objective &&
    lane.readOnly === expected.readOnly && same(lane.launchProfile, expected.launchProfile) &&
    !lane.dependencies?.length && workflow.ownership?.createdBy === 'herdr-orchestrator' &&
    workflow.ownership.workspaceId === previous.workspaceId && workflow.ownership.paneIds?.includes(lane.paneId) &&
    workflow.ownership.tabIds?.includes(lane.tabId), 'Failed workflow differs from original scope or native ownership');
  const native = await nativePreflight({ ...options, prepared, ensureSource: false });
  require(same(native, nativeReadiness), 'Native root/source binding changed since preparation');
  const parent = workflow.worktreeBinding?.repoParent;
  require(native.source && parent?.workspaceId === native.source.workspaceId &&
    await realpath(parent.checkoutPath) === native.source.checkout, 'Workflow source binding changed');
  const response = await exec(env.HERDR_BIN_PATH || 'herdr', ['agent', 'get', lane.paneId], { cwd, signal, timeout: 15000 });
  require(response.code === 0, 'Cannot inspect existing child');
  const raw = JSON.parse(response.stdout), agent = (raw.result ?? raw).agent;
  require(!raw.error && raw.ok !== false && agent?.agent === 'claude' && agent.pane_id === lane.paneId &&
    agent.workspace_id === previous.workspaceId && agent.tab_id === lane.tabId && agent.name === lane.agentName &&
    agent.agent_status === 'idle' && agent.interactive_ready === true && !agent.launch_pending &&
    agent.agent_session?.kind === 'id' && agent.agent_session.value === lane.agentSessionPath &&
    await realpath(agent.cwd) === prepared.target, 'Existing child is not the same idle, ready native Claude session');
  const directory = path.dirname(manifestPath);
  require(lane.startupIntentPath === path.join(directory, `${workflow.id}-${lane.id}-startup.json`), 'Unexpected original startup proof path');
  const intent = await proofFile(lane.startupIntentPath, directory);
  const ready = await proofFile(`${lane.startupIntentPath}.ready`, directory);
  require(intent.value.version === 1 && intent.value.workflowId === workflow.id && intent.value.laneId === lane.id &&
    intent.value.incarnationId === lane.incarnationId && ready.value.version === 1 &&
    ready.value.harness === 'claude' && ready.value.sessionId === agent.agent_session.value &&
    typeof intent.value.source === 'string' && ready.value.source === intent.value.source &&
    [intent.value, ready.value].every(value => value.nonce === lane.startupNonce && value.paneId === lane.paneId &&
      value.workspaceId === previous.workspaceId && same(value.profile, lane.launchProfile)) &&
    ['complete', 'plan', 'dispatch'].every(op => ready.value.operations?.includes(op)),
  'Original startup attestation differs from this child, incarnation or profile');
  require(before.equals(await readFile(manifestPath)) && same(prepared, await inspectLanePrerequisites(input)),
    'Evidence changed during retry inspection; inspect again');
  return { mode: 'startup-retry', sourcePath: prepared.sourcePath, sourceSha256: prepared.sourceSha256,
    current: { root: prepared.root, sessionFile, paneId: previous.paneId, workspaceId: previous.workspaceId },
    proposedStep: { code: 'review-startup-retry', taskId: previous.taskId, workflowId: previous.workflowId },
    readiness: { state: 'passed', evidence: { retryOf: previous.intentId, native, rootHead: prepared.rootHead,
      targetHead: prepared.targetHead, workflowHash: hash(JSON.stringify(workflow)),
      child: { paneId: lane.paneId, tabId: lane.tabId, sessionId: agent.agent_session.value },
      startupIntentHash: intent.hash, startupReadyHash: ready.hash,
      profiles: [{ agentKind: lane.agentKind, launchProfile: lane.launchProfile }] } } };
}
