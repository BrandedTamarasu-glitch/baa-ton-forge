import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { controllerRegistration } from './controller-registration.js';

export const manifestDirectories = ['.baa-ton/herdr-orchestrator', '.pi/herdr-orchestrator'];

// Resolve the nearest existing ancestor, including Windows directory aliases.
export async function canonicalPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Native path must be absolute and contain no control characters');
  try { return await realpath(value); }
  catch (error) {
    if (error.code !== 'ENOENT' || path.dirname(value) === value) throw error;
    return path.join(await canonicalPath(path.dirname(value)), path.basename(value));
  }
}

const object = value => value && typeof value === 'object' && !Array.isArray(value);

// An alternate ledger is harmless only when its known ownership records can be
// attributed to other roots. Unknown/unscoped state cannot prove that separation.
async function assertOtherRoots(filename, mapping) {
  const conflict = detail => { throw new Error(`Ambiguous Baa-ton manifests: ${detail} in ${filename}; preserve both ledgers and inspect registered root ownership`); };
  let manifest;
  try { manifest = JSON.parse(await readFile(filename, 'utf8')); }
  catch { conflict('alternate ledger is unreadable'); }
  if (!object(manifest) || ![1, 2].includes(manifest.version) || !Array.isArray(manifest.workflows)) conflict('alternate ledger has an unsupported shape');
  const known = ['version', 'workflows', 'sessionLog', 'rootSessionLogs', 'parentGoals', 'goalHistoryByRoot', 'rootQueues', 'parentGoal', 'goalHistory', 'queue', 'questionRequests', 'messageRequests'];
  if (Object.keys(manifest).some(key => !known.includes(key))) conflict('alternate ledger has unknown ownership state');
  const check = (value, key) => {
    if (!object(value)) conflict('invalid root ownership');
    const id = value.rootId ?? key;
    if (id === mapping.id || key === mapping.id) conflict('same-root state exists in both layouts');
    if (key && value.rootId && value.rootId !== key) conflict('contradictory root IDs');
    const pairs = [[value.root?.pane_id, value.root?.workspace_id], [value.rootPaneId ?? value.paneId, value.workspaceId]]
      .filter(([pane, workspace]) => pane !== undefined || workspace !== undefined);
    for (const [pane, workspace] of pairs) {
      if (typeof pane !== 'string' || !pane || typeof workspace !== 'string' || !workspace) conflict('incomplete root ownership');
      if (pane === mapping.root.pane_id && workspace === mapping.root.workspace_id) conflict('same-root state exists in both layouts');
    }
    if (pairs.length === 2 && (pairs[0][0] !== pairs[1][0] || pairs[0][1] !== pairs[1][1])) conflict('contradictory root identities');
    if (!(typeof id === 'string' && id) && !pairs.length) conflict('unattributed root state');
    if (value.supervisor?.rootTurn !== undefined) check(value.supervisor.rootTurn);
  };
  if (manifest.sessionLog !== undefined) {
    if (manifest.sessionLog?.kind !== 'root') conflict('invalid root session log');
    check(manifest.sessionLog);
  }
  for (const workflow of manifest.workflows) {
    if (!object(workflow) || !object(workflow.taskBinding)) conflict('workflow has no root binding');
    check(workflow.taskBinding);
  }
  for (const key of ['questionRequests', 'messageRequests']) {
    if (manifest[key] === undefined) continue;
    if (!Array.isArray(manifest[key])) conflict('invalid root request history');
    for (const request of manifest[key]) {
      if (!object(request) || request.paneId === mapping.root.pane_id) conflict('invalid or same-root request history');
      if (request.workflowId !== undefined) {
        if (manifest.workflows.filter(workflow => workflow.id === request.workflowId).length !== 1) conflict('request has no unique workflow owner');
      } else if (!manifest.sessionLog) conflict('unscoped request has no root owner');
    }
  }
  if (manifest.rootSessionLogs !== undefined) {
    if (!Array.isArray(manifest.rootSessionLogs)) conflict('invalid scoped session logs');
    for (const log of manifest.rootSessionLogs) check(log);
  }
  if (manifest.parentGoals !== undefined) {
    if (!object(manifest.parentGoals)) conflict('invalid scoped goals');
    if (manifest.parentGoals.version !== undefined) {
      if (!Array.isArray(manifest.parentGoals.roots)) conflict('invalid scoped goals');
      for (const goal of manifest.parentGoals.roots) { check(goal); if (goal.goal !== undefined) check(goal.goal, goal.rootId); }
    } else for (const [key, goal] of Object.entries(manifest.parentGoals)) {
      check({ rootId: key }); check(goal, key); if (goal.goal !== undefined) check(goal.goal, key);
    }
  }
  if (manifest.goalHistoryByRoot !== undefined) {
    if (!object(manifest.goalHistoryByRoot)) conflict('invalid scoped goal history');
    for (const [key, history] of Object.entries(manifest.goalHistoryByRoot)) {
      if (!Array.isArray(history)) conflict('invalid scoped goal history');
      check({ rootId: key });
    }
  }
  if (manifest.rootQueues !== undefined) {
    if (!Array.isArray(manifest.rootQueues?.roots)) conflict('invalid scoped queues');
    for (const queue of manifest.rootQueues.roots) check(queue);
  }
  if (['parentGoal', 'goalHistory', 'queue'].some(key => manifest[key] !== undefined) && !manifest.sessionLog)
    conflict('unscoped legacy goal/queue state has no root owner');
  if (manifest.parentGoal?.supervisor?.rootTurn !== undefined) check(manifest.parentGoal.supervisor.rootTurn);
  if (manifest.goalHistory !== undefined) {
    if (!Array.isArray(manifest.goalHistory)) conflict('invalid legacy goal history');
    for (const goal of manifest.goalHistory) if (goal?.supervisor?.rootTurn !== undefined) check(goal.supervisor.rootTurn);
  }
}

// Never merge, migrate, or fall back from a registered ledger. A single layout
// remains readable offline; two layouts require the current native registration.
export async function resolveManifestPath(cwd, { registeredPath, env = process.env } = {}) {
  const root = await realpath(cwd);
  const candidates = [];
  for (const directory of manifestDirectories) {
    const filename = path.join(root, directory, 'manifest.json');
    let info;
    try { info = await lstat(filename); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (info && (!info.isFile() || info.isSymbolicLink()))
      throw new Error(`Manifest must be a regular non-symlink file: ${filename}`);
    const canonical = await canonicalPath(filename);
    const relative = path.relative(root, canonical);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error('Manifest path resolves outside the root checkout');
    candidates.push({ filename: canonical, exists: Boolean(info) });
  }
  const existing = candidates.filter(item => item.exists);
  const dual = new Set(existing.map(item => item.filename)).size > 1;
  let mapping;
  if (dual) {
    ({ mapping } = await controllerRegistration(root, env));
    const authoritative = await canonicalPath(mapping.program.parent_manifest_path);
    if (!candidates.some(item => item.filename === authoritative))
      throw new Error('Registered manifest belongs to another checkout or unsupported layout');
    if (registeredPath !== undefined && await canonicalPath(registeredPath) !== authoritative)
      throw new Error('Registered manifest changed during inspection; inspect controller registration');
    registeredPath = authoritative;
  }
  if (registeredPath !== undefined) {
    const registered = await canonicalPath(registeredPath);
    const selected = candidates.find(item => item.filename === registered);
    if (!selected) throw new Error('Registered manifest belongs to another checkout or unsupported layout');
    if (existing.length && !selected.exists)
      throw new Error('Registered manifest disagrees with the existing checkout manifest; inspect controller registration without replacing state');
    if (dual) for (const alternate of existing.filter(item => item.filename !== selected.filename))
      await assertOtherRoots(alternate.filename, mapping);
    return selected.filename;
  }
  return existing[0]?.filename ?? candidates[0].filename;
}
