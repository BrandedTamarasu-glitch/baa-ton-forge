import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { loadPreview } from './planner.js';
import { submissionRecovered } from './recovery.js';
import { resolveManifestPath } from './manifest-path.js';

const exec = promisify(execFile);
async function git(cwd, ...args) {
  return (await exec('git', ['-C', cwd, ...args], { maxBuffer: 1024 * 1024 })).stdout.trim();
}
export async function checkout(cwd, { requireClean = true } = {}) {
  const canonical = await realpath(cwd);
  const root = await realpath(await git(canonical, 'rev-parse', '--show-toplevel'));
  if (canonical !== root) throw new Error('Use the checkout root, not a subdirectory');
  if (requireClean && await git(root, 'status', '--porcelain', '--untracked-files=all')) throw new Error(`Checkout is dirty: ${root}`);
  const head = await git(root, 'rev-parse', '--verify', 'HEAD');
  const commonDir = await realpath(await git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
  const gitDir = await realpath(await git(root, 'rev-parse', '--absolute-git-dir'));
  const branch = await git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => null);
  return { root, head, branch, commonDir, linked: commonDir !== gitDir };
}
export function identity(env = process.env) {
  if (env.HERDR_ENV !== '1' || !env.HERDR_PANE_ID || !env.HERDR_WORKSPACE_ID) throw new Error('Prepare requires a real Herdr pane with pane and workspace identity');
  return { paneId: env.HERDR_PANE_ID, workspaceId: env.HERDR_WORKSPACE_ID };
}
async function ancestor(cwd, commit) {
  if (!/^[0-9a-f]{40,64}$/.test(commit ?? '')) throw new Error('Verification requires a full commit hash');
  try { await git(cwd, 'merge-base', '--is-ancestor', commit, 'HEAD'); }
  catch { throw new Error(`Verified commit ${commit} is not integrated in ${cwd}`); }
}

// Shared read-only checks. This does not authorize a new planning submission.
export async function inspectLanePrerequisites({ filename, taskId, preview, cwd, records = [], env = process.env }) {
  const pane = identity(env);
  const current = await loadPreview(filename, { cwd });
  if (!preview || preview.sourcePath !== current.sourcePath || preview.sourceSha256 !== current.sourceSha256) throw new Error('Brief or task profile configuration is new or changed; run /forgeflow-plan-lanes again before preparing');
  const workflow = current.workflows.find(item => item.taskId === taskId);
  if (!workflow) throw new Error(`Unknown task: ${taskId}`);
  if (!workflow.planArguments) throw new Error('Assign the writer worktree, then preview again');
  // Baa-ton dispatch mandates an explicit launch profile with no substitution;
  // reject here so no profile-less workflow is ever created and then stranded.
  for (const lane of workflow.planArguments.lanes) {
    if (!lane.launchProfile) throw new Error(`Task ${taskId} has no launchProfile; add one to the brief task before preparing`);
  }
  // An explicit application has its own clean integration checkout. Unrelated
  // controller edits are not application state; identity and HEAD still matter.
  const root = await checkout(cwd, { requireClean: !workflow.repoCwd });
  const repository = workflow.repoCwd ? await checkout(workflow.repoCwd) : root;
  const target = await checkout(workflow.planArguments.worktreeCwd ?? cwd);
  if (target.commonDir !== repository.commonDir) throw new Error('Target belongs to a different repository than the declared repository or root');
  if ((!workflow.readOnly || workflow.repoCwd) && (!target.linked || target.root === repository.root || target.root === root.root)) throw new Error('Writer or explicit repository task requires a distinct linked worktree');
  for (const dependency of workflow.afterVerifiedAndIntegrated) {
    const record = records.findLast(item => item.kind === 'verified' && item.taskId === dependency && item.sourceSha256 === current.sourceSha256 && item.sourcePath === current.sourcePath && item.root === root.root);
    if (!record) throw new Error(`Dependency ${dependency} has no root verification record for this brief`);
    const dependencyTask = current.workflows.find(item => item.taskId === dependency);
    const integrated = await checkout(dependencyTask.repoCwd ?? cwd);
    if (dependencyTask.repoCwd && (!record.repository || record.repository.root !== integrated.root || record.repository.commonDir !== integrated.commonDir)) throw new Error(`Dependency ${dependency} has no matching repository verification`);
    await ancestor(integrated.root, record.commit);
    if (integrated.commonDir === repository.commonDir) {
      await ancestor(repository.root, record.commit);
      await ancestor(target.root, record.commit);
    }
  }
  return { kind: 'prepared', taskId, sourcePath: current.sourcePath, sourceSha256: current.sourceSha256, root: root.root, rootHead: root.head, target: target.root, targetHead: target.head, ...(workflow.repoCwd ? { repository, targetBranch: target.branch } : {}), ...pane, planArguments: workflow.planArguments };
}

export async function prepareLane(options) {
  const prepared = await inspectLanePrerequisites(options);
  const records = options.records ?? [];
  const previous = records.findLast(item => ['planned', 'planning'].includes(item.kind) && !submissionRecovered(item, records) && item.taskId === prepared.taskId && item.sourcePath === prepared.sourcePath && item.sourceSha256 === prepared.sourceSha256 && item.root === prepared.root);
  if (previous) throw new Error(`Task already mapped or submitted (${previous.workflowId ?? previous.toolCallId}); inspect the Baa-ton ledger instead of replanning`);
  return prepared;
}

export async function revalidate(prepared, records, env = process.env) {
  const current = await prepareLane({ filename: prepared.sourcePath, taskId: prepared.taskId, preview: prepared, cwd: prepared.root, records, env });
  if (!isDeepStrictEqual(current, prepared)) throw new Error('Checkout or pane changed since prepare; prepare the lane again');
}

export function matchPlan(prepared, event) {
  return event.toolName === 'herdr_plan' && isDeepStrictEqual(event.input, prepared.planArguments);
}

export async function reconcileLane({ filename, taskId, workflowId, cwd, sessionFile, env = process.env }) {
  const pane = identity(env);
  const preview = await loadPreview(filename, { cwd });
  const task = preview.workflows.find(item => item.taskId === taskId);
  const proposed = task?.planArguments;
  if (!proposed) throw new Error('Brief has no plannable task with that ID');
  const root = await checkout(cwd, { requireClean: !task.repoCwd });
  const target = await checkout(proposed.worktreeCwd ?? cwd);
  const repository = task.repoCwd ? await checkout(task.repoCwd) : root;
  if (target.commonDir !== repository.commonDir) throw new Error('Target belongs to a different repository');
  const manifest = JSON.parse(await readFile(await resolveManifestPath(root.root), 'utf8'));
  const matches = manifest.workflows?.filter(workflow => workflow.id === workflowId) ?? [];
  if (matches.length !== 1) throw new Error('Expected exactly one durable workflow with that ID');
  const workflow = matches[0];
  const binding = workflow.taskBinding;
  if (!sessionFile || binding?.rootSessionPath !== sessionFile || binding?.workspaceId !== pane.workspaceId || binding?.rootPaneId !== pane.paneId) throw new Error('Workflow belongs to another root session, pane, or workspace');
  if (workflow.cwd !== target.root || workflow.objective !== proposed.objective || workflow.lanes?.length !== proposed.lanes.length) throw new Error('Workflow does not match the brief objective, checkout, or lane count');
  for (let i = 0; i < proposed.lanes.length; i++) {
    const expected = proposed.lanes[i], actual = workflow.lanes[i];
    if (actual.objective !== expected.objective || actual.readOnly !== expected.readOnly || actual.agentKind !== expected.agentKind || !isDeepStrictEqual(actual.launchProfile, expected.launchProfile) || (actual.dependencies?.length ?? 0) !== 0) throw new Error('Workflow lane does not match the brief scope, profile, or dependencies');
  }
  if (task.repoCwd) {
    const parent = workflow.worktreeBinding?.repoParent;
    if (!parent?.checkoutPath || !parent.workspaceId || !target.linked || target.root === repository.root || target.root === root.root) throw new Error('Workflow has no matching linked-worktree repository binding');
    const nativeRepository = await checkout(parent.checkoutPath);
    if (nativeRepository.commonDir !== repository.commonDir) throw new Error('Native worktree source belongs to a different repository');
  } else {
    if (!proposed.lanes[0].readOnly && (!target.linked || target.root === root.root || workflow.worktreeBinding?.repoParent?.checkoutPath !== root.root || workflow.worktreeBinding?.repoParent?.workspaceId !== pane.workspaceId)) throw new Error('Writer workflow has no matching linked-worktree parent binding');
  }
  return { kind: 'planned', taskId, sourcePath: preview.sourcePath, sourceSha256: preview.sourceSha256, root: root.root, target: target.root, ...(task.repoCwd ? { repository, targetBranch: target.branch } : {}), ...pane, workflowId, planArguments: proposed, reconciledAt: new Date().toISOString(), mappingSource: 'durable-manifest' };
}

export async function verifyLane({ mapped, commit, evidence, cwd }) {
  if (!evidence?.trim()) throw new Error('Supply the checks independently rerun and their results');
  const root = await checkout(cwd, { requireClean: !mapped.repository });
  if (root.root !== mapped.root) throw new Error('Verification must run in the mapped root checkout');
  const manifest = JSON.parse(await readFile(await resolveManifestPath(root.root), 'utf8'));
  const workflow = manifest.workflows?.find(item => item.id === mapped.workflowId);
  if (!workflow || workflow.cwd !== mapped.target || !workflow.lanes?.length || workflow.lanes.some(lane => !lane.completionReceipt?.id || !lane.completionReceipt?.summary)) throw new Error('Matching durable lane completion receipts are required before root verification');
  const target = await checkout(mapped.target);
  if (target.head !== commit) throw new Error('Commit must match the reviewed lane checkout HEAD');
  const repository = mapped.repository ? await checkout(mapped.repository.root) : root;
  if (mapped.repository && (repository.commonDir !== mapped.repository.commonDir || target.commonDir !== repository.commonDir)) throw new Error('Reviewed repository identity changed');
  if (mapped.repository && (repository.branch !== mapped.repository.branch || target.branch !== mapped.targetBranch)) throw new Error('Repository or worker branch changed since mapping');
  await ancestor(repository.root, commit);
  return { ...mapped, kind: 'verified', commit, evidence: evidence.trim(), verifiedAt: new Date().toISOString() };
}
