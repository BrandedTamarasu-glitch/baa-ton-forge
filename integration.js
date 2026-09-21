import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { verificationGuidance } from './verification-guidance.js';
import { integrationValidation } from './verification-handoff.js';
import { checkout } from './prepare.js';
import { loadPreview } from './planner.js';

const exec = promisify(execFile);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function ancestor(cwd, base, target) {
  try { await exec('git', ['--no-optional-locks', '-C', cwd, 'merge-base', '--is-ancestor', base, target]); return true; }
  catch (error) { if (error.code === 1) return false; throw error; }
}
// Match the native approval path's deliberately restricted shell grammar.
export function fastForwardCommand(destination, commit) {
  const portable = destination.replaceAll('\\', '/');
  if (!/^[-\w./ :]+$/.test(portable) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit))
    throw new Error('Destination cannot be represented by the native fast-forward approval grammar. No alternate command is permitted.');
  return `rtk proxy git -C "${portable}" merge --ff-only ${commit}`;
}

export async function integrationPreview(options) {
  const guidance = await verificationGuidance({ ...options, beforeIntegration: true });
  const report = { mode: 'integration-preview', executed: false, authorization: 'not-assessed',
    current: guidance.current, sourcePath: guidance.sourcePath, sourceSha256: guidance.sourceSha256,
    taskId: options.taskId, workflowId: guidance.workflowId, reviewTaskId: options.reviewTaskId ?? null,
    state: 'blocked', blockers: [...guidance.blockers], evidence: guidance.evidence,
    validation: null, destination: null, command: null, fingerprint: null, next: null };
  try {
    if (!guidance.evidence || guidance.blockers.length) return report;
    const preview = await loadPreview(options.filename, { cwd: options.cwd });
    const writer = preview.workflows.find(item => item.taskId === options.taskId);
    if (writer.readOnly) throw new Error('Select a completed writer task as the integration source.');
    if (preview.sourceSha256 !== guidance.sourceSha256) throw new Error('Brief changed during inspection.');
    const manifestBytes = await readFile(guidance.manifestPath);
    report.workflowSha256 = hash(JSON.parse(manifestBytes).workflows.filter(item => item.id === report.workflowId));
    let destination = guidance.evidence.repository;
    if (options.reviewTaskId) {
      const review = preview.workflows.find(item => item.taskId === options.reviewTaskId);
      if (!review?.readOnly || !review.afterVerifiedAndIntegrated.includes(options.taskId) || !review.planArguments?.worktreeCwd)
        throw new Error('Select an existing linked read-only task that depends on this writer in the same brief.');
      if (!guidance.historicalVerification || guidance.historicalVerification.commit !== guidance.evidence.commit || !guidance.evidence.integrated)
        throw new Error('Record final writer verification after application integration before advancing a review checkout.');
      if ((options.records ?? []).some(item => ['prepared', 'planning', 'planned'].includes(item.kind) &&
          item.sourcePath === preview.sourcePath && item.taskId === review.taskId && item.root === guidance.current.root))
        throw new Error('Review already has preparation or workflow records; inspect it instead of moving its checkout.');
      const repo = await checkout(review.repoCwd ?? options.cwd);
      destination = await checkout(review.planArguments.worktreeCwd);
      if (!destination.linked || repo.commonDir !== guidance.evidence.repository.commonDir ||
          destination.commonDir !== repo.commonDir || destination.root === repo.root || destination.root === guidance.evidence.target.root)
        throw new Error('Review destination must be a distinct linked checkout in the writer repository.');
      for (const workflow of JSON.parse(manifestBytes).workflows) {
        if (workflow.cwd && await realpath(workflow.cwd).catch(() => null) === destination.root)
          throw new Error('Review destination already belongs to a durable workflow. Do not move an existing lane checkout.');
      }
      // Other dependencies must already be independently verified and present in the target commit.
      for (const dependency of review.afterVerifiedAndIntegrated.filter(id => id !== options.taskId)) {
        const verification = (options.records ?? []).findLast(item => item.kind === 'verified' && item.taskId === dependency &&
          item.sourcePath === preview.sourcePath && item.sourceSha256 === preview.sourceSha256 && item.root === guidance.current.root);
        if (!verification || !await ancestor(destination.root, verification.commit, guidance.evidence.commit))
          throw new Error(`Review dependency ${dependency} is not verified in the proposed commit.`);
      }
      report.validation = { kind: 'historical-final-verification', ...guidance.historicalVerification };
    }
    report.destination = destination;
    if (!destination.branch) throw new Error('Integration requires a named destination branch; detached HEAD is unsupported.');
    const already = await ancestor(destination.root, guidance.evidence.commit, destination.head);
    const ff = await ancestor(destination.root, destination.head, guidance.evidence.commit);
    if (!already && !ff) throw new Error('Destination has diverged; only a fast-forward is supported. No reset, rebase or merge commit will be attempted.');
    if (!already && !options.reviewTaskId)
      report.validation = integrationValidation(guidance, options.records ?? [], options.entries ?? []);
    const attempts = (options.records ?? []).filter(item => item.kind === 'integration-intent' &&
      item.workflowId === report.workflowId && item.reviewTaskId === report.reviewTaskId);
    if (!options.ignoreAttempt && attempts.some(item => !(options.records ?? []).some(result =>
      result.kind === 'integration-result' && result.intentId === item.intentId && result.outcome === 'integrated')))
      throw new Error('An earlier integration handoff is unresolved or failed. Inspect its audit; no automatic retry.');
    const { status: _status, ...destinationIdentity } = destination;
    if (!isDeepStrictEqual(guidance, await verificationGuidance({ ...options, beforeIntegration: true })) ||
        !isDeepStrictEqual(destinationIdentity, await checkout(destination.root)) ||
        !manifestBytes.equals(await readFile(guidance.manifestPath)))
      throw new Error('Integration evidence changed during inspection.');
    report.state = already ? 'already-integrated' : 'ready-for-native-approval';
    report.command = already ? null : fastForwardCommand(destination.root, guidance.evidence.commit);
    report.next = options.reviewTaskId
      ? `/forgeflow-prepare-lane "${preview.sourcePath}" ${options.reviewTaskId}`
      : `/forgeflow-verification-handoff "${preview.sourcePath}" ${options.taskId}`;
    report.fingerprint = hash({ current: report.current, sourcePath: report.sourcePath, sourceSha256: report.sourceSha256,
      taskId: report.taskId, workflowId: report.workflowId, reviewTaskId: report.reviewTaskId,
      evidence: report.evidence, workflowSha256: report.workflowSha256, validation: report.validation, destination, command: report.command });
  } catch (error) {
    report.state = 'blocked'; report.command = null;
    report.blockers.push(error instanceof Error ? error.message : String(error));
  }
  return report;
}

export function renderIntegration(report) {
  return [`Integration: ${report.taskId} | Workflow: ${report.workflowId ?? 'unmapped'}`,
    `State: ${report.state}`, 'Preview only. No merge, verification, review preparation or dispatch performed.',
    ...(report.evidence ? [`Writer commit: ${report.evidence.commit}`, `Validation: ${JSON.stringify(report.validation)}`,
      `Writer checkout: ${report.evidence.target.root}`, `Application checkout: ${report.evidence.repository.root}`] : []),
    ...(report.destination ? [`Destination: ${report.destination.root} | Branch: ${report.destination.branch} | HEAD: ${report.destination.head}`] : []),
    ...report.blockers.map(item => `Blocked: ${item}`),
    ...(report.command ? ['Proposed native-approved command (not executed):', report.command] : []),
    ...(report.next ? [`After this step, inspect the next operation separately: ${report.next}`] : []),
    'A receipt is not root validation. Pre-integration validation is not final verification. Native approval and fresh checks are still required.',
  ].join('\n');
}
