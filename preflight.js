import { lstat, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { checkout, identity } from './prepare.js';
import { isDeepStrictEqual } from 'node:util';
import { ensureSourceWorkspace } from './source-workspace.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
function required(value, key, context) {
  if (typeof value?.[key] !== 'string' || !value[key]) throw new Error(`${context}: missing ${key}; inspect native Herdr metadata before preparing`);
  return value[key];
}

// The default and submission paths are read-only. Only native preparation opts
// into source creation, after all ownership and repository checks have passed.
export async function nativePreflight(options) {
  const first = await probe(options);
  if (!first.missing) return first.readiness;
  if (!options.ensureSource || !options.prepared.repository) {
    throw new Error('Application source workspace is unavailable: missing source_workspace_id; inspect native Herdr metadata before preparing');
  }
  if (first.sourceCheckout !== options.prepared.repository.root)
    throw new Error('Automatic source setup requires the native source checkout to equal repoCwd; inspect repository selection');
  return ensureSourceWorkspace({
    initial: first,
    probe: async () => {
      const fresh = await probe(options);
      if (!isDeepStrictEqual(fresh.readiness.root, first.readiness.root) ||
          fresh.sourceCheckout !== first.sourceCheckout || fresh.repoKey !== first.repoKey || fresh.commonDir !== first.commonDir)
        throw new Error('Native root or repository changed during source setup; no further creation attempted');
      return fresh;
    },
  });
}

async function probe({ prepared, sessionFile, exec, env = process.env, signal }) {
  const pane = identity(env);
  if (!sessionFile || !path.isAbsolute(sessionFile)) throw new Error('Native Pi session identity is unavailable; resume the owning session before preparing');
  if (typeof exec !== 'function') throw new Error('Native Herdr inspection is unavailable; load this adapter in Pi before preparing');
  const configDir = env.HERDR_PLUGIN_CONFIG_DIR || (process.platform === 'win32'
    ? path.join(env.APPDATA || path.join(homedir(), 'AppData/Roaming'), 'herdr/plugins/config/herdr-orchestrator-controller')
    : path.join(homedir(), '.config/herdr/plugins/config/herdr-orchestrator-controller'));
  if (!path.isAbsolute(configDir)) throw new Error('Controller config directory must be absolute; inspect the installed Baa-ton configuration');
  const configPath = path.join(configDir, 'config.json');
  let config;
  try {
    const info = await lstat(configPath);
    if (!info.isFile() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o022))) throw new Error('unsafe config file');
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch { throw new Error('Controller registration is unavailable or invalid; inspect Baa-ton root registration before preparing (do not reset it)'); }
  if (config.version !== 2 || config.owner !== 'herdr-orchestrator' || !Array.isArray(config.orchestrators))
    throw new Error('Unsupported controller registration; inspect or update Baa-ton before preparing');
  const matches = config.orchestrators.filter(item => item?.root?.pane_id === pane.paneId && item.root.workspace_id === pane.workspaceId);
  if (matches.length !== 1) throw new Error('Current pane/workspace has no unique registered controller root; resume the owner or use audited Baa-ton root recovery');
  const mapping = matches[0], root = mapping.root;
  if (root.agent_kind !== 'pi' || !mapping.id || !['name', 'pane_id'].includes(root.target_kind) || !root.target ||
      (root.target_kind === 'pane_id' && root.target !== pane.paneId)) throw new Error('Registered root identity is invalid or is not Pi; inspect Baa-ton registration');
  const manifestPath = path.join(prepared.root, '.pi/herdr-orchestrator/manifest.json');
  if (mapping.program?.workspace_id !== pane.workspaceId ||
      mapping.program?.parent_manifest_path !== manifestPath ||
      !path.isAbsolute(mapping.program?.id ?? '') || await realpath(mapping.program.id) !== prepared.root)
    throw new Error('Registered root belongs to another checkout; use that root or audited recovery before preparing');
  async function inspect(args) {
    const result = await exec(env.HERDR_BIN_PATH || 'herdr', args, { cwd: prepared.root, timeout: 15000, signal });
    if (result.code !== 0) throw new Error(`Native Herdr ${args.slice(0, 2).join(' ')} failed; inspect connectivity and readiness before preparing`);
    let response;
    try { response = JSON.parse(result.stdout); } catch { throw new Error('Native Herdr returned invalid JSON; inspect the installed CLI before preparing'); }
    if (response.error || response.ok === false) throw new Error('Native Herdr inspection reported an error; repair the prerequisite before preparing');
    const value = response.result ?? response;
    if (!object(value)) throw new Error('Native Herdr response has no result object');
    return value;
  }
  const agent = (await inspect(['agent', 'get', pane.paneId])).agent;
  if (!agent || agent.pane_id !== pane.paneId || agent.workspace_id !== pane.workspaceId || agent.agent !== 'pi' ||
      (root.target_kind === 'name' && agent.name !== root.target)) throw new Error('Live agent differs from the registered root; stop and inspect native ownership');
  if (agent.agent_session?.kind !== 'path' || agent.agent_session.value !== sessionFile)
    throw new Error('Live root session differs from this Pi session; resume the owning session before preparing');
  const readiness = { version: 1, root: { registrationId: mapping.id, configPath, target: root.target, targetKind: root.target_kind,
    ...pane, sessionFile, checkout: prepared.root }, source: null };
  if (!prepared.planArguments.worktreeCwd) return { readiness };
  const inventory = await inspect(['worktree', 'list', '--cwd', prepared.target]);
  const source = inventory.source;
  const sourceWorkspaceId = source?.source_workspace_id;
  if (sourceWorkspaceId !== undefined && (typeof sourceWorkspaceId !== 'string' || !sourceWorkspaceId.trim()))
    throw new Error('Native source_workspace_id is malformed; inspect native Herdr metadata');
  const sourceCheckout = await realpath(required(source, 'source_checkout_path', 'Worktree source'));
  const repoKey = required(source, 'repo_key', 'Worktree source');
  const repoRoot = await realpath(required(source, 'repo_root', 'Worktree source'));
  const repository = await checkout(prepared.repository?.root ?? prepared.root);
  const nativeRepository = await checkout(sourceCheckout);
  if (nativeRepository.commonDir !== repository.commonDir ||
      sourceCheckout === prepared.target) throw new Error('Native source does not match the declared repository; inspect source-workspace binding before preparing');
  if (!Array.isArray(inventory.worktrees)) throw new Error('Native worktree inventory is unavailable');
  const targets = [];
  for (const item of inventory.worktrees) {
    if (typeof item?.path === 'string' && path.resolve(item.path) === prepared.target) targets.push(item);
  }
  if (targets.length !== 1) throw new Error('Target must appear exactly once in native worktree inventory; repair registration before preparing');
  if (targets[0].open_workspace_id) throw new Error('Target worktree already has an open native workspace; inspect the existing workflow instead of replanning');
  const spaces = (await inspect(['workspace', 'list'])).workspaces;
  if (!Array.isArray(spaces)) throw new Error('Native workspace inventory is unavailable');
  if (spaces.some(item => !object(item) || typeof item.workspace_id !== 'string' || !item.workspace_id) ||
      new Set(spaces.map(item => item.workspace_id)).size !== spaces.length)
    throw new Error('Application source workspace no longer exists uniquely; native inventory is ambiguous');
  const candidates = spaces.filter(item => item.worktree?.repo_key === repoKey &&
    typeof item.worktree.checkout_path === 'string' && path.resolve(item.worktree.checkout_path) === sourceCheckout);
  if (candidates.length > 1 || (candidates.length === 1 && candidates[0].workspace_id !== sourceWorkspaceId))
    throw new Error('Source workspace inventory disagrees with native binding; inspect existing workspace instead of creating another');
  if (!sourceWorkspaceId) return { readiness, missing: true, sourceCheckout, repoKey, commonDir: repository.commonDir, spaces, inspect };
  const parents = spaces.filter(item => item?.workspace_id === sourceWorkspaceId);
  if (parents.length !== 1) throw new Error('Application source workspace no longer exists uniquely; restore an agent-free source workspace through Herdr, then prepare again');
  const meta = parents[0].worktree;
  if (meta && (meta.repo_key !== repoKey || !meta.checkout_path || path.resolve(meta.checkout_path) !== sourceCheckout))
    throw new Error('Source workspace repository metadata disagrees with worktree inventory; inspect native registration');
  readiness.source = { workspaceId: sourceWorkspaceId, checkout: sourceCheckout, repoKey, repoRoot, target: prepared.target };
  return { readiness, sourceCheckout, repoKey, commonDir: repository.commonDir, spaces, inspect };
}
