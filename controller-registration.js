import { lstat, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

// Read-only authority lookup shared by preflight and dual-layout ledger readers.
export async function controllerRegistration(cwd, env = process.env) {
  const paneId = env.HERDR_PANE_ID, workspaceId = env.HERDR_WORKSPACE_ID;
  if (env.HERDR_ENV !== '1' || !paneId || !workspaceId)
    throw new Error('Manifest selection requires a real Herdr root pane/workspace and its unique controller registration');
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
  const matches = config.orchestrators.filter(item => item?.root?.pane_id === paneId && item.root.workspace_id === workspaceId);
  if (matches.length !== 1) throw new Error('Current pane/workspace has no unique registered controller root; resume the owner or use audited Baa-ton root recovery');
  const mapping = matches[0], root = mapping.root;
  if (root.agent_kind !== 'pi' || typeof mapping.id !== 'string' || !mapping.id ||
      config.orchestrators.filter(item => item?.id === mapping.id).length !== 1 ||
      !['name', 'pane_id'].includes(root.target_kind) || !root.target ||
      (root.target_kind === 'pane_id' && root.target !== paneId)) throw new Error('Registered root identity is invalid or is not Pi; inspect Baa-ton registration');
  if (mapping.program?.workspace_id !== workspaceId ||
      !path.isAbsolute(mapping.program?.id ?? '') || await realpath(mapping.program.id) !== await realpath(cwd))
    throw new Error('Registered root belongs to another checkout; use that root or audited recovery before preparing');
  if (typeof mapping.program?.parent_manifest_path !== 'string') throw new Error('Registered root has no manifest path');
  return { mapping, configPath };
}
