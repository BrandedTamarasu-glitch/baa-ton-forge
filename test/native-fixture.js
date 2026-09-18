import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function nativeFixture(f, env) {
  const configDir = path.join(path.dirname(f.root), 'native-controller');
  await mkdir(configDir, { recursive: true });
  const sessionFile = path.join(path.dirname(f.root), 'session.jsonl');
  const config = { version: 2, owner: 'herdr-orchestrator', orchestrators: [{
    id: 'registered-root', root: { pane_id: env.HERDR_PANE_ID, workspace_id: env.HERDR_WORKSPACE_ID,
      target: env.HERDR_PANE_ID, target_kind: 'pane_id', agent_kind: 'pi' },
    program: { id: f.root, workspace_id: env.HERDR_WORKSPACE_ID, parent_manifest_path: path.join(f.root, '.pi/herdr-orchestrator/manifest.json') },
    workflows: [],
  }] };
  const configPath = path.join(configDir, 'config.json');
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const nativeEnv = { ...env, HERDR_PLUGIN_CONFIG_DIR: configDir };
  const responses = {
    agent: { agent: { pane_id: env.HERDR_PANE_ID, workspace_id: env.HERDR_WORKSPACE_ID, agent: 'pi', agent_session: { kind: 'path', value: sessionFile } } },
    worktree: { source: { source_workspace_id: 'source-workspace', source_checkout_path: f.root, repo_root: f.root, repo_key: path.join(f.root, '.git') }, worktrees: [{ path: f.target }] },
    workspace: { workspaces: [{ workspace_id: 'source-workspace' }] },
  };
  const calls = [];
  const exec = async (binary, args) => {
    calls.push({ binary, args });
    if (!(['agent', 'worktree', 'workspace'].includes(args[0]) && ['get', 'list'].includes(args[1]))) throw new Error('Unexpected mutating command');
    return { code: 0, stdout: JSON.stringify({ result: responses[args[0]] }) };
  };
  return { env: nativeEnv, configPath, config, responses, calls, exec, sessionFile };
}
