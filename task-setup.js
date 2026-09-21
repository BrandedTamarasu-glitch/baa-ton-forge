import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { checkout } from './prepare.js';
import { buildPreview, loadPreview } from './planner.js';

const exec = promisify(execFile);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function git(cwd, ...args) {
  return (await exec('git', ['-C', cwd, ...args], { maxBuffer: 1024 * 1024 })).stdout.trim();
}
async function absent(filename) {
  try { await lstat(filename); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Setup destination already exists: ${filename}; inspect it rather than overwriting or adopting it`);
}
function inside(parent, child) {
  const relative = path.relative(parent, child);
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function assignment(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['taskProfile', 'agentKind', 'launchProfile'].includes(key)) ||
      (value.taskProfile === undefined && value.launchProfile === undefined))
    throw new Error(`${label} requires a configured taskProfile or an exact launchProfile and agentKind`);
  if (value.taskProfile === undefined && !value.agentKind) throw new Error(`${label} requires an explicit agentKind`);
  return value;
}

// No files are created by preview. Natural-language interpretation belongs to
// the owning Pi model; this boundary validates the resulting explicit choices.
export async function previewTaskSetup(input, cwd) {
  if (Object.keys(input).some(key => !['name', 'objective', 'acceptance', 'files', 'checks', 'repoCwd', 'parentDirectory', 'writer', 'reviewer'].includes(key)))
    throw new Error('Unknown task setup field');
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(input.name ?? '')) throw new Error('Setup name must be 1–48 lowercase letters, digits or hyphens, starting with a letter');
  if (!path.isAbsolute(input.repoCwd ?? '')) throw new Error('repoCwd must be an absolute application checkout path');
  const controller = await checkout(cwd, { requireClean: false });
  const repository = await checkout(input.repoCwd);
  const parent = await realpath(input.parentDirectory ?? path.dirname(repository.root));
  if (!path.isAbsolute(input.parentDirectory ?? parent)) throw new Error('parentDirectory must be absolute');
  const directory = path.join(parent, `${path.basename(repository.root)}-forge-${input.name}`);
  if (inside(controller.root, directory) || inside(repository.root, directory)) throw new Error('Task setup directory must be outside the controller and application checkouts');
  await absent(directory);
  const branch = `forge/${input.name}`;
  await git(repository.root, 'check-ref-format', '--branch', branch);
  if (await git(repository.root, 'for-each-ref', '--format=%(refname)', `refs/heads/${branch}`)) throw new Error(`Branch ${branch} already exists; choose a new task name`);
  const writer = assignment(input.writer, 'Writer'), reviewer = assignment(input.reviewer, 'Reviewer');
  let config, configSha256;
  if (writer.taskProfile !== undefined || reviewer.taskProfile !== undefined) {
    const contents = await readFile(path.join(controller.root, '.baa-ton/config.json'), 'utf8');
    if (Buffer.byteLength(contents) > 256 * 1024) throw new Error('Task profile config exceeds 256 KiB');
    config = JSON.parse(contents); configSha256 = hash(contents);
  }
  const worktreeCwd = path.join(directory, 'writer');
  const brief = { version: 1, objective: input.objective, acceptance: input.acceptance, tasks: [
    { id: 'writer', objective: input.objective, files: input.files, checks: input.checks, repoCwd: repository.root, worktreeCwd, ...writer },
    { id: 'review', objective: `Independently review: ${input.objective}`, files: input.files, checks: input.checks, repoCwd: repository.root, worktreeCwd: path.join(directory, 'review'), readOnly: true, dependsOn: ['writer'], ...reviewer },
  ] };
  if (Buffer.byteLength(`${JSON.stringify(brief, null, 2)}\n`) > 256 * 1024) throw new Error('Generated brief exceeds 256 KiB');
  const preview = buildPreview(brief, {}, config);
  if (preview.workflows[0].readOnly) throw new Error('Writer assignment resolves to a read-only profile');
  // Freeze resolved assignments; retaining named profiles lets normal preview
  // and preparation continue to detect subsequent configuration changes.
  const plan = { input, controller, repository, directory, branch, filename: path.join(directory, 'brief.json'), brief,
    configSha256: configSha256 ?? null, assignments: preview.workflows.map(item => item.planArguments.lanes[0]) };
  return { ...plan, draftId: hash(plan) };
}

export async function applyTaskSetup(draft, cwd) {
  // Recompute all checks and exact profile choices before any mutation.
  const fresh = await previewTaskSetup(draft.input, cwd);
  if (fresh.draftId !== draft.draftId) throw new Error('Setup preview is stale; preview again before applying');
  const journalDirectory = path.join(fresh.repository.commonDir, 'forgeflow-task-setup');
  await mkdir(journalDirectory, { recursive: true });
  const journal = path.join(journalDirectory, `${fresh.input.name}.json`);
  const record = { draftId: fresh.draftId, controller: fresh.controller.root, repository: fresh.repository.root, directory: fresh.directory, branch: fresh.branch, base: fresh.repository.head, state: 'started' };
  try { await writeFile(journal, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`A setup attempt already exists at ${journal}; inspect its resources before retrying`); throw error; }
  try {
    await mkdir(fresh.directory);
    await git(fresh.repository.root, 'worktree', 'add', '-b', fresh.branch, fresh.brief.tasks[0].worktreeCwd, fresh.repository.head);
    const target = await checkout(fresh.brief.tasks[0].worktreeCwd);
    if (!target.linked || target.commonDir !== fresh.repository.commonDir || target.head !== fresh.repository.head || target.branch !== fresh.branch)
      throw new Error('Created worktree differs from the reviewed setup');
    await git(fresh.repository.root, 'worktree', 'add', '--detach', fresh.brief.tasks[1].worktreeCwd, fresh.repository.head);
    const review = await checkout(fresh.brief.tasks[1].worktreeCwd);
    if (!review.linked || review.commonDir !== fresh.repository.commonDir || review.head !== fresh.repository.head || review.branch !== null)
      throw new Error('Created review worktree differs from the reviewed setup');
    const repository = await checkout(fresh.repository.root);
    if (hash(repository) !== hash(fresh.repository)) throw new Error('Application checkout changed during setup');
    await writeFile(fresh.filename, `${JSON.stringify(fresh.brief, null, 2)}\n`, { flag: 'wx' });
    const preview = await loadPreview(fresh.filename, { cwd });
    if (hash(preview.workflows.map(item => item.planArguments.lanes[0])) !== hash(fresh.assignments)) throw new Error('Worker profiles changed during setup; inspect the generated brief before proceeding');
    await writeFile(journal, JSON.stringify({ ...record, state: 'complete', filename: fresh.filename }, null, 2));
    return { filename: fresh.filename, worktree: target.root, reviewWorktree: review.root, branch: target.branch, journal, preview };
  } catch (error) {
    // Never remove worktrees/branches or retry an uncertain Git operation.
    throw new Error(`Task setup stopped: ${error.message}. Inspect ${journal} and ${fresh.directory}; existing resources were preserved.`);
  }
}

export function registerTaskSetup(pi, records) {
  const assignmentSchema = { type: 'object', properties: { taskProfile: { type: 'string' }, agentKind: { type: 'string', enum: ['pi', 'claude', 'codex', 'opencode'] }, launchProfile: { type: 'object', properties: Object.fromEntries(['provider', 'model', 'thinking', 'auth'].map(key => [key, { type: 'string' }])), required: ['provider', 'model', 'thinking', 'auth'], additionalProperties: false } }, additionalProperties: false };
  const list = { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 };
  pi.registerTool({ name: 'forgeflow_setup_preview', label: 'Preview guided task setup',
    description: 'Turn an agreed task into a reviewed setup for one writer and a dependent read-only reviewer. Gather objective, acceptance, file scopes, checks, application repo and authorized worker assignments from the user/context; clarify unresolved requirements and never invent models. Pass these structured fields yourself; users need not edit JSON. Reads Git and configured profiles, saves a session draft, and returns the exact brief, branch, paths and resolved assignments. Creates no files/worktrees. Review the result before forgeflow_setup_apply under existing user authorization. The separate detached review checkout must be fast-forwarded to the integrated writer commit before review preparation.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, objective: { type: 'string' }, acceptance: list, files: list, checks: list, repoCwd: { type: 'string' }, parentDirectory: { type: 'string' }, writer: assignmentSchema, reviewer: assignmentSchema }, required: ['name', 'objective', 'acceptance', 'files', 'checks', 'repoCwd', 'writer', 'reviewer'], additionalProperties: false },
    execute: async (_id, params, _signal, _update, ctx) => {
      const draft = await previewTaskSetup(params, ctx.cwd);
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) throw new Error('Task setup requires a persistent owning Pi session');
      pi.appendEntry('forgeflow-adapter', { kind: 'setup-draft', sessionFile, draft });
      return { content: [{ type: 'text', text: JSON.stringify(draft, null, 2) }], details: draft };
    },
  });
  pi.registerTool({ name: 'forgeflow_setup_apply', label: 'Create reviewed task setup',
    description: 'Apply an exact reviewed setup draft from this Pi session under existing user authorization to create its brief, writer branch and separate writer/review Git worktrees. Rechecks Git/profile snapshots and refuses existing resources or ambiguous earlier attempts. Saves the ordinary lane preview; next call forgeflow_prepare_lane for writer to establish native readiness. Does not plan or dispatch. No extra user confirmation is needed when the existing request already authorizes these exact resources.',
    parameters: { type: 'object', properties: { draftId: { type: 'string' } }, required: ['draftId'], additionalProperties: false },
    execute: async (_id, params, _signal, _update, ctx) => {
      const saved = records(ctx).findLast(item => item.kind === 'setup-draft' && item.draft.draftId === params.draftId);
      if (!saved || !saved.sessionFile || saved.sessionFile !== ctx.sessionManager.getSessionFile()) throw new Error('No matching setup draft in this owning Pi session');
      const result = await applyTaskSetup(saved.draft, ctx.cwd);
      pi.appendEntry('forgeflow-adapter', { kind: 'preview', sourcePath: result.preview.sourcePath, sourceSha256: result.preview.sourceSha256 });
      pi.appendEntry('forgeflow-adapter', { kind: 'setup-complete', draftId: params.draftId, filename: result.filename, worktree: result.worktree, reviewWorktree: result.reviewWorktree, journal: result.journal });
      return { content: [{ type: 'text', text: `Task setup created at ${result.filename}. Next: forgeflow_prepare_lane with filename=${JSON.stringify(result.filename)}, taskId="writer". Native ownership/readiness must pass before planning. Review remains blocked until writer integration, root verification and an authorized fast-forward of ${result.reviewWorktree} to the integrated commit.` }], details: result };
    },
  });
}
