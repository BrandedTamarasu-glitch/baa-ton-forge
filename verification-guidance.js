import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkout } from './prepare.js';
import { laneStatus } from './status.js';
import { loadPreview } from './planner.js';

const exec = promisify(execFile);
async function git(cwd, ...args) {
  return (await exec('git', ['--no-optional-locks', '-C', cwd, ...args], { maxBuffer: 1024 * 1024 })).stdout;
}
async function isAncestor(cwd, base, head) {
  try { await git(cwd, 'merge-base', '--is-ancestor', base, head); return true; }
  catch (error) { if (error.code === 1) return false; throw error; }
}
async function inspectCheckout(cwd) {
  return { ...await checkout(cwd, { requireClean: false }), status: await git(cwd, 'status', '--porcelain=v1', '--untracked-files=all') };
}

export async function verificationGuidance(options) {
  const status = await laneStatus(options);
  const task = status.tasks.find(item => item.taskId === options.taskId);
  if (!task) throw new Error(`Unknown task: ${options.taskId}`);
  const report = { mode: 'verification-guidance', taskId: task.taskId, workflowId: task.workflowId,
    sourcePath: status.sourcePath, sourceSha256: status.sourceSha256, current: status.current,
    state: 'blocked', checksRun: false, verified: false, blockers: [], evidence: null,
    historicalVerification: task.verification, requiredChecks: [], acceptance: [],
    next: 'Independently review scope/content, run required checks and record their actual results. Commit/integration require existing authorization; this tool performs neither.' };
  if (!['verify-completion', 'none'].includes(task.nextAction.code)) {
    report.blockers.push(task.nextAction.reason); return report;
  }
  try {
    const preview = await loadPreview(options.filename, { cwd: options.cwd });
    if (preview.sourceSha256 !== status.sourceSha256) throw new Error('Brief changed during inspection');
    const definition = preview.workflows.find(item => item.taskId === task.taskId);
    report.requiredChecks = definition.checks;
    report.acceptance = preview.acceptance;
    const mapped = (options.records ?? []).findLast(item => item.kind === 'planned' && item.workflowId === task.workflowId &&
      item.taskId === task.taskId && item.root === status.current.root && item.sourcePath === status.sourcePath && item.sourceSha256 === status.sourceSha256);
    if (!mapped) throw new Error('Matching mapping record is missing');
    if (definition.repoCwd && !mapped.repository) throw new Error('Explicit application mapping lacks repository identity; inspect the original mapping');
    const manifestPath = path.join(status.current.root, '.pi/herdr-orchestrator/manifest.json');
    const manifest = await readFile(manifestPath);
    const root = await checkout(options.cwd, { requireClean: !definition.repoCwd });
    const target = await inspectCheckout(definition.planArguments.worktreeCwd ?? root.root);
    const repository = await inspectCheckout(definition.repoCwd ?? root.root);
    if (target.root !== mapped.target || target.commonDir !== repository.commonDir ||
        (mapped.repository && (mapped.repository.root !== repository.root || mapped.repository.commonDir !== repository.commonDir)))
      throw new Error('Mapped checkout/repository identity changed');
    if (mapped.repository && (mapped.repository.branch !== repository.branch || mapped.targetBranch !== target.branch))
      throw new Error('Mapped integration or lane branch changed');
    const integrated = await isAncestor(repository.root, target.head, repository.head);
    report.evidence = { target, repository, commit: target.head, integrated,
      baseline: mapped.targetHead ?? null, committedPaths: null, scope: 'not-checked' };
    if (target.status) report.blockers.push('Lane has uncommitted or untracked changes. HEAD does not include all working-tree results; inspect before an authorized commit.');
    if (repository.status) report.blockers.push('Application integration checkout is dirty; preserve its changes and resolve ownership before integration.');
    if (!integrated) report.blockers.push('Lane HEAD is not integrated into the application checkout. Inspect the diff and authorization before integration.');
    if (!/^[0-9a-f]{40,64}$/.test(mapped.targetHead ?? '')) {
      report.blockers.push('Original lane baseline is unavailable; independently establish scope provenance. Do not invent a baseline.');
    } else if (!await isAncestor(target.root, mapped.targetHead, target.head)) {
      report.blockers.push('Lane HEAD no longer descends from the saved preparation baseline. Investigate history.');
    } else {
      const files = (await git(target.root, 'diff', '--name-only', '--no-renames', '-z', mapped.targetHead, target.head, '--')).split('\0').filter(Boolean);
      const outside = files.filter(file => !definition.files.some(scope => scope.endsWith('/') ? file.startsWith(scope) : file === scope));
      report.evidence.committedPaths = files;
      report.evidence.scope = outside.length ? 'outside-declared-scope' : 'paths-within-declared-scope';
      if (outside.length) report.blockers.push(`Committed paths outside declared scope: ${outside.join(', ')}`);
      if (definition.readOnly && files.length) report.blockers.push('Read-only lane HEAD differs from its prepared baseline; investigate the change.');
    }
    if (!manifest.equals(await readFile(manifestPath)) ||
        !isDeepStrictEqual(target, await inspectCheckout(target.root)) ||
        !isDeepStrictEqual(repository, await inspectCheckout(repository.root)) ||
        !isDeepStrictEqual(root, await checkout(options.cwd, { requireClean: !definition.repoCwd })) ||
        !isDeepStrictEqual(status, await laneStatus(options))) throw new Error('Evidence changed during inspection; inspect again');
    report.state = report.blockers.length ? 'blocked' : 'awaiting-independent-validation';
  } catch (error) {
    report.evidence = null;
    report.blockers.push(error instanceof Error ? error.message : String(error));
  }
  return report;
}

export function renderVerificationGuidance(report) {
  return [
    `Verification guidance: ${report.taskId} | Workflow: ${report.workflowId ?? 'unmapped'}`,
    `State: ${report.state}`,
    'Read-only inspection. Tests not run; content not reviewed; verification not saved. Receipt and path checks are not proof of correctness.',
    ...(report.historicalVerification ? [`Historical verification: ${report.historicalVerification.commit}; this inspection does not refresh it.`] : []),
    ...(report.evidence ? [
      `Lane HEAD: ${report.evidence.commit} | Branch: ${report.evidence.target.branch ?? 'detached'}`,
      `Lane status: ${report.evidence.target.status || 'clean'}`,
      `Integration checkout: ${report.evidence.repository.root} | HEAD: ${report.evidence.repository.head}`,
      `Integration status: ${report.evidence.repository.status || 'clean'} | Contains lane HEAD: ${report.evidence.integrated}`,
      `Committed scope: ${report.evidence.scope} | Paths: ${report.evidence.committedPaths?.join(', ') || 'none or unavailable'}`,
    ] : []),
    ...report.blockers.map(item => `Blocked: ${item}`),
    ...report.requiredChecks.map(item => `Required validation (not run): ${item}`),
    ...report.acceptance.map(item => `Acceptance to review: ${item}`),
    `Next: ${report.next}`,
  ].join('\n');
}
