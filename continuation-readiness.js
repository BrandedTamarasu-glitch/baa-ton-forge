import { readFile, realpath } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { laneStatus } from './status.js';
import { continuationPreview } from './continuation.js';
import { inspectLanePrerequisites } from './prepare.js';
import { nativePreflight } from './preflight.js';

export async function checkContinuation(options) {
  const status = await laneStatus(options);
  const report = continuationPreview(status);
  report.mode = 'continuation-readiness';
  report.readiness = { state: 'not-checked', checks: [], blockers: [], runtimeQualification: 'not-checked' };
  const step = report.proposedStep;
  if (!step || !['prepare', 'plan', 'review-dispatch'].includes(step.code)) {
    report.readiness.blockers.push('Resolve the proposed status step first; readiness checks apply only before preparation, planning or dispatch.');
    return report;
  }
  try {
    const manifestPath = status.manifestPath;
    const before = await readFile(manifestPath);
    const records = options.records ?? [];
    const preview = records.findLast(item => item.kind === 'preview' && item.sourcePath === status.sourcePath);
    const input = { ...options, taskId: step.taskId, preview };
    const prepared = await inspectLanePrerequisites(input);
    const saved = records.findLast(item => item.kind === 'prepared' && item.taskId === step.taskId && item.root === prepared.root && item.sourcePath === prepared.sourcePath && item.sourceSha256 === prepared.sourceSha256);
    if (step.code !== 'prepare') {
      if (!saved) throw new Error('No original preparation evidence; inspect the owning session before proceeding');
      const { nativeReadiness, sessionFile, ...local } = saved;
      if (sessionFile !== options.sessionFile || !isDeepStrictEqual(local, prepared)) throw new Error('Checkout, profile or session changed since preparation; inspect existing workflow before proceeding');
    }
    report.readiness.checks.push(prepared.repository
      ? 'Controller identity/HEAD, clean application/target, linked-worktree constraints, exact configured profile and dependency integration checked; unrelated controller edits allowed.'
      : 'Clean root/target, linked-worktree constraints, exact configured profile and dependency integration checked.');
    const native = await nativePreflight({ prepared, sessionFile: options.sessionFile, sessionId: options.sessionId, proveSession: options.proveSession, exec: options.exec, env: options.env, signal: options.signal, ensureSource: false });
    if (step.code !== 'prepare' && !isDeepStrictEqual(saved.nativeReadiness, native)) throw new Error('Native root or source binding changed since preparation; inspect the existing workflow');
    if (step.code === 'review-dispatch' && native.source) {
      const workflow = JSON.parse(before).workflows.find(item => item.id === step.workflowId);
      const parent = workflow?.worktreeBinding?.repoParent;
      if (!parent?.checkoutPath || parent.workspaceId !== native.source.workspaceId ||
          await realpath(parent.checkoutPath) !== native.source.checkout)
        throw new Error('Planned workflow source binding differs from current native evidence; inspect it before dispatch');
    }
    report.readiness.checks.push('Native controller/root session, source binding and target availability checked.');
    if (!isDeepStrictEqual(await inspectLanePrerequisites(input), prepared) ||
        !before.equals(await readFile(manifestPath)) || !isDeepStrictEqual(await laneStatus(options), status))
      throw new Error('Evidence changed during readiness inspection; take a fresh snapshot');
    report.readiness.state = 'passed';
    report.readiness.evidence = { native, rootHead: prepared.rootHead, targetHead: prepared.targetHead,
      profiles: prepared.planArguments.lanes.map(lane => ({ agentKind: lane.agentKind, launchProfile: lane.launchProfile })) };
    report.nativeReadiness = 'checked';
    report.stopReason = 'Read-only prerequisite checks passed at inspection time. Authorization and provider/model runtime qualification remain unassessed. Baa-ton must revalidate before any dispatch; no operation was executed.';
  } catch (error) {
    report.readiness.state = 'blocked';
    report.readiness.blockers.push(error instanceof Error ? error.message : String(error));
    report.nativeReadiness = 'not-established';
    report.stopReason = 'Readiness blocked. No repair, source creation, planning or dispatch attempted.';
  }
  return report;
}
