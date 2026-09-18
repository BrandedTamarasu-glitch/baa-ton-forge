import { access, readFile, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { manifestDirectories } from './manifest-path.js';

const exec = promisify(execFile);
const adapterPath = fileURLToPath(new URL('./extension.js', import.meta.url));

// Configuration inspection only: Pi's resource loader remains authoritative for
// packages, directory discovery, exclusion patterns and runtime tool registration.
export async function checkInstallation({ project = process.cwd(), agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi/agent'), env = process.env } = {}) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  add('node', Number(process.versions.node.split('.')[0]) >= 20 ? 'pass' : 'fail', `Node ${process.versions.node}; requires 20+`);
  const root = await realpath(project);
  const git = async (...args) => (await exec('git', ['-C', root, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })).stdout.trim();
  try {
    const top = await realpath(await git('rev-parse', '--show-toplevel'));
    add('checkout', top === root ? 'pass' : 'fail', top === root ? root : `Use checkout root ${top}`);
    await git('rev-parse', '--verify', 'HEAD');
    add('committed-head', 'pass', 'Repository has a committed HEAD');
    add('clean-checkout', (await git('status', '--porcelain')).length ? 'warn' : 'pass', 'Lane preparation requires a clean checkout');
    for (const directory of ['.forgeflow', ...manifestDirectories]) {
      const tracked = await git('ls-files', '--', directory);
      let ignored = false;
      try { await git('check-ignore', '-q', '--', `${directory}/.adapter-install-probe`); ignored = true; }
      catch (error) { if (error.code !== 1) throw error; }
      add(`local-state:${directory}`, !tracked && ignored ? 'pass' : 'fail', tracked ? 'Workflow state is tracked; inspect it before proceeding' : ignored ? 'Probe path is ignored by Git' : 'Add this directory to the repository-local Git exclude file');
    }
  } catch (error) {
    add('git', 'fail', `Cannot inspect committed checkout: ${error.message}`);
  }
  const registrations = [];
  for (const filename of [path.join(agentDir, 'settings.json'), path.join(root, '.pi/settings.json')]) {
    try {
      const settings = JSON.parse(await readFile(filename, 'utf8'));
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('expected settings object');
      if (settings.extensions !== undefined && (!Array.isArray(settings.extensions) || settings.extensions.some(entry => typeof entry !== 'string'))) throw new Error('extensions must be an array of strings');
      for (const entry of settings.extensions ?? []) {
        if (entry.startsWith('!') || /[*?\[\]]/.test(entry)) continue;
        const expanded = entry.startsWith('~/') ? path.join(os.homedir(), entry.slice(2)) : entry;
        const resolved = path.resolve(path.dirname(filename), expanded);
        try { registrations.push(await realpath(resolved)); } catch { /* absent paths cannot prove installation */ }
      }
      add(`settings:${filename}`, 'pass', 'Settings readable; values are not displayed');
    } catch (error) {
      if (error.code !== 'ENOENT') add(`settings:${filename}`, 'fail', 'Settings unreadable or invalid; inspect the file locally');
    }
  }
  await access(adapterPath);
  const registered = registrations.includes(await realpath(adapterPath));
  add('adapter-registration', registered ? 'pass' : 'warn', registered ? 'Direct adapter path found in Pi settings; runtime loading still needs confirmation' : 'Direct adapter path not confirmed; inspect Pi registration (package/directory discovery is not evaluated)');
  const identityPresent = env.HERDR_ENV === '1' && Boolean(env.HERDR_PANE_ID) && Boolean(env.HERDR_WORKSPACE_ID);
  add('herdr-environment', identityPresent ? 'pass' : 'warn', identityPresent ? `Pane ${env.HERDR_PANE_ID}, workspace ${env.HERDR_WORKSPACE_ID}; environment only, not registration proof` : 'Run live setup in the target project Herdr pane; identity is not established here');
  add('live-readiness', 'warn', 'Not checked: native tool availability, controller mappings, plugin enablement, provider login and herdr_doctor. Check these inside the real Pi root.');
  return { mode: 'read-only-installation-check', project: root, agentDir: path.resolve(agentDir), ok: checks.every(check => check.status !== 'fail'), checks };
}

export function renderInstallation(report) {
  return [`Project: ${report.project}`, 'Read-only local checks; this report does not authorize dispatch or register a root.', ...report.checks.map(check => `${check.status.toUpperCase()} ${check.name}: ${check.detail}`)].join('\n');
}
