import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveTaskProfile } from './profiles.js';

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function text(value, label) {
  requireValue(typeof value === 'string' && value.trim().length > 0, `${label} must be nonempty text`);
  return value.trim();
}
function strings(value, label, required = false) {
  requireValue(Array.isArray(value) && (!required || value.length > 0), `${label} must be ${required ? 'a nonempty' : 'an'} array`);
  return [...new Set(value.map(item => text(item, label)))];
}
function keys(value, allowed, label) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  for (const key of Object.keys(value)) requireValue(allowed.includes(key), `${label}: unknown field ${key}`);
}
function fileScope(value) {
  const scope = text(value, 'file scope');
  requireValue(!path.posix.isAbsolute(scope) && !scope.includes('\\') && !scope.includes(':') && !/[\x00-\x1f*?\[\]{}]/.test(scope), `Invalid relative file scope: ${scope}`);
  requireValue(scope.split('/').every((part, i, parts) => (part !== '' || i === parts.length - 1) && part !== '.' && part !== '..'), `Invalid relative file scope: ${scope}`);
  requireValue(!scope.split('/').includes('.git'), 'Git metadata cannot be owned');
  return scope;
}
function overlaps(a, b) {
  return a.replace(/\/$/, '') === b.replace(/\/$/, '') || (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b));
}

export function parseBrief(source) {
  if (source.trimStart().startsWith('{')) return JSON.parse(source);
  const blocks = [...source.matchAll(/^```forgeflow-lanes\s*\r?\n([\s\S]*?)^```\s*$/gm)];
  requireValue(blocks.length === 1, 'Markdown must contain exactly one ```forgeflow-lanes JSON block');
  return JSON.parse(blocks[0][1]);
}

export async function loadPreview(filename, { cwd = process.cwd() } = {}) {
  const source = await readFile(filename, 'utf8');
  requireValue(Buffer.byteLength(source) <= 256 * 1024, 'Brief exceeds 256 KiB');
  const brief = parseBrief(source);
  const sha = value => createHash('sha256').update(value).digest('hex');
  const metadata = { sourcePath: path.resolve(filename), sourceSha256: sha(source) };
  let config;
  if (Array.isArray(brief?.tasks) && brief.tasks.some(task => task?.taskProfile !== undefined)) {
    const configPath = path.join(await realpath(cwd), '.baa-ton/config.json');
    let contents;
    try { contents = await readFile(configPath, 'utf8'); }
    catch { throw new Error(`Cannot read task profiles at ${configPath}; run from the owning project root and configure the selected profiles`); }
    requireValue(Buffer.byteLength(contents) <= 256 * 1024, 'Task profile config exceeds 256 KiB');
    try { config = JSON.parse(contents); }
    catch { throw new Error(`Invalid JSON in ${configPath}`); }
    metadata.briefSha256 = metadata.sourceSha256;
    metadata.profileConfig = { path: configPath, sha256: sha(contents) };
    metadata.sourceSha256 = sha(JSON.stringify([metadata.briefSha256, configPath, metadata.profileConfig.sha256]));
  }
  if (brief?.tasks?.some(task => task.repoCwd !== undefined)) {
    metadata.repositoryIds = {};
    const controllerPath = await realpath(cwd);
    for (const directory of new Set([controllerPath, ...brief.tasks.map(task => task.repoCwd).filter(value => value !== undefined)])) {
      requireValue(typeof directory === 'string' && path.isAbsolute(directory), 'repoCwd must be absolute');
      const canonical = await realpath(directory);
      const { stdout } = await promisify(execFile)('git', ['-C', canonical, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
      const commonDir = await realpath(stdout.trim());
      metadata.repositoryIds[path.resolve(directory)] = commonDir;
    }
    metadata.defaultRepositoryId = metadata.repositoryIds[controllerPath];
    metadata.briefSha256 ??= sha(source);
    // The caller cwd can be a Windows short path or a directory alias, while
    // preparation stores its real path. Normalize that key while retaining the
    // existing fingerprint format for roots already using canonical paths.
    metadata.sourceSha256 = sha(JSON.stringify([metadata.sourceSha256, metadata.repositoryIds, metadata.defaultRepositoryId]));
  }
  return buildPreview(brief, metadata, config);
}

export function buildPreview(brief, source = {}, profileConfig) {
  keys(brief, ['version', 'objective', 'acceptance', 'tasks'], 'brief');
  requireValue(brief.version === 1, 'brief.version must be 1');
  const objective = text(brief.objective, 'objective');
  const acceptance = strings(brief.acceptance, 'acceptance', true);
  requireValue(Array.isArray(brief.tasks) && brief.tasks.length > 0 && brief.tasks.length <= 50, 'tasks must contain 1–50 entries');
  const tasks = brief.tasks.map(task => {
    keys(task, ['id', 'objective', 'files', 'checks', 'dependsOn', 'readOnly', 'agentKind', 'launchProfile', 'taskProfile', 'worktreeCwd', 'repoCwd'], 'task');
    requireValue(task.readOnly === undefined || typeof task.readOnly === 'boolean', 'task.readOnly must be boolean');
    task = resolveTaskProfile(task, profileConfig);
    const id = text(task.id, 'task.id');
    requireValue(/^[a-z][a-z0-9-]{0,63}$/.test(id), `Invalid task id: ${id}`);
    requireValue(task.readOnly === undefined || typeof task.readOnly === 'boolean', `${id}: readOnly must be boolean`);
    const agentKind = task.agentKind ?? 'pi';
    requireValue(['pi', 'claude', 'codex', 'opencode'].includes(agentKind), `${id}: agentKind must be pi, claude, codex, or opencode; other recognized Herdr kinds have no qualified launch adapter in the supported Baa-ton version`);
    if (task.launchProfile !== undefined) {
      keys(task.launchProfile, ['provider', 'model', 'thinking', 'auth'], `${id}.launchProfile`);
      for (const field of ['provider', 'model', 'thinking']) text(task.launchProfile[field], field);
      requireValue(task.launchProfile.auth === 'subscription', `${id}: launchProfile.auth must be subscription`);
    }
    if (task.repoCwd !== undefined) requireValue(path.isAbsolute(text(task.repoCwd, 'repoCwd')), `${id}: repoCwd must be absolute`);
    if (task.worktreeCwd !== undefined) requireValue(path.isAbsolute(text(task.worktreeCwd, 'worktreeCwd')), `${id}: worktreeCwd must be absolute`);
    return { ...task, id, objective: text(task.objective, `${id}.objective`), files: strings(task.files, `${id}.files`, true).map(fileScope), checks: strings(task.checks, `${id}.checks`, true), dependsOn: strings(task.dependsOn ?? [], `${id}.dependsOn`), readOnly: task.readOnly ?? false, agentKind };
  });
  const byId = new Map(tasks.map(task => [task.id, task]));
  requireValue(byId.size === tasks.length, 'Task ids must be unique');
  const dependencies = new Map(tasks.map(task => [task.id, new Set(task.dependsOn)]));
  for (const task of tasks) for (const dependency of task.dependsOn) requireValue(byId.has(dependency) && dependency !== task.id, `${task.id}: invalid dependency ${dependency}`);
  function ordered(ids) {
    const remaining = new Set(ids), result = [];
    while (remaining.size) {
      const ready = [...remaining].filter(id => [...dependencies.get(id)].every(dep => !remaining.has(dep)));
      requireValue(ready.length > 0, 'Dependency cycle; check explicit dependencies and review ordering');
      result.push(ready);
      ready.forEach(id => remaining.delete(id));
    }
    return result;
  }
  // Honor explicit ordering before adding conservative ownership edges.
  const initial = ordered(tasks.map(task => task.id)).flat();
  const conflicts = [];
  const writers = initial.map(id => byId.get(id)).filter(task => !task.readOnly);
  const worktrees = writers.filter(task => task.worktreeCwd).map(task => path.resolve(task.worktreeCwd));
  requireValue(new Set(worktrees).size === worktrees.length, 'Writer tasks must use distinct worktree paths');
  for (let i = 0; i < writers.length; i++) for (let j = i + 1; j < writers.length; j++) {
    const a = writers[i], b = writers[j];
    const repoId = task => task.repoCwd ? (source.repositoryIds?.[path.resolve(task.repoCwd)] ?? path.resolve(task.repoCwd)) : source.defaultRepositoryId ?? '<root>';
    if (repoId(a) !== repoId(b)) continue;
    const shared = a.files.flatMap(left => b.files.filter(right => overlaps(left, right)).map(right => [left, right]));
    if (shared.length) {
      dependencies.get(b.id).add(a.id);
      conflicts.push({ before: a.id, after: b.id, scopes: shared });
    }
  }
  // Reviewers see the integrated result, after every writer has been verified.
  for (const task of tasks.filter(task => task.readOnly)) for (const writer of writers) dependencies.get(task.id).add(writer.id);
  const stages = ordered(tasks.map(task => task.id));
  const workflows = tasks.map(task => {
    const laneObjective = [task.objective, '', `${task.readOnly ? 'Read-only scope' : 'Exclusive write scope'}:`, ...task.files.map(file => `- ${file}`), '', 'Validation required:', ...task.checks.map(check => `- ${check}`), '', 'Acceptance criteria:', ...acceptance.map(item => `- ${item}`), '', 'Use Baa-ton completion receipts. Do not spawn nested agents. Root independently verifies all claims.'].join('\n');
    const lane = { objective: laneObjective, readOnly: task.readOnly, agentKind: task.agentKind, ...(task.launchProfile ? { launchProfile: task.launchProfile } : {}) };
    return {
      taskId: task.id, objective: task.objective, readOnly: task.readOnly, files: task.files, checks: task.checks,
      ...(task.taskProfile !== undefined ? { taskProfile: task.taskProfile } : {}),
      ...(task.repoCwd !== undefined ? { repoCwd: path.resolve(task.repoCwd) } : {}),
      afterVerifiedAndIntegrated: [...dependencies.get(task.id)],
      blockers: [...(!task.worktreeCwd && (!task.readOnly || task.repoCwd !== undefined) ? ['Assign a clean, pre-existing worktree before planning.'] : []), 'Root must verify current checkout, pane identity, authorization, and harness capabilities before planning.'],
      planArguments: (!task.readOnly || task.repoCwd !== undefined) && !task.worktreeCwd ? null : { objective: `${objective}: ${task.objective}`, lanes: [lane], ...(task.worktreeCwd ? { worktreeCwd: task.worktreeCwd } : {}) },
    };
  });
  return { version: 1, mode: 'preview-only', ...source, objective, acceptance, stages, conflicts, workflows };
}

export function renderPreview(preview) {
  return [`Baa-ton lane preview: ${preview.objective}`, ...(preview.profileConfig ? [`Profile config: ${preview.profileConfig.path}`, `Profile config SHA-256: ${preview.profileConfig.sha256}`] : []), '', 'Preview only. No lanes dispatched or workflow ledgers changed. Explicit repository identities are inspected read-only.', 'Cross-workflow dependencies below must be enforced by the root; they are not Baa-ton lane dependencies.', 'Write scopes are instructions, not filesystem sandbox rules.', '', ...preview.stages.map((ids, i) => `Stage ${i + 1}: ${ids.join(', ')}`), '', ...preview.workflows.flatMap(workflow => [`${workflow.taskId}: ${workflow.readOnly ? 'read-only' : 'writer'}`, ...(workflow.taskProfile ? [`Task profile: ${workflow.taskProfile} (resolved to explicit launch arguments)`] : []), `Repository: ${workflow.repoCwd ?? 'controller checkout'}`, `Objective: ${workflow.objective}`, `Scope: ${workflow.files.join(', ')}`, `Checks: ${workflow.checks.join('; ')}`, `After verified and integrated: ${workflow.afterVerifiedAndIntegrated.join(', ') || 'none'}`, ...workflow.blockers.map(blocker => `Pending: ${blocker}`), ...(workflow.planArguments ? ['Proposed herdr_plan arguments:', '```json', JSON.stringify(workflow.planArguments, null, 2), '```'] : ['Plan arguments withheld until a writer worktree is assigned.']), ''])].join('\n');
}
