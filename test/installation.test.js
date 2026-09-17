import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { checkInstallation } from '../installation.js';

const extension = fileURLToPath(new URL('../extension.js', import.meta.url));
const cli = fileURLToPath(new URL('../check-install.js', import.meta.url));
async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'adapter install '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const project = path.join(base, 'second project'), agentDir = path.join(base, 'agent');
  await mkdir(project); await mkdir(agentDir);
  const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(project, 'README.md'), 'Second project');
  git('add', 'README.md'); git('commit', '-m', 'Initial');
  const exclude = path.join(project, '.git/info/exclude');
  await writeFile(exclude, '.forgeflow/\n.pi/herdr-orchestrator/\n');
  await writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({ extensions: [extension] }));
  return { project, agentDir, env: {}, exclude, git };
}

test('shared global installation checks second project without writes or invented identity', async t => {
  const f = await fixture(t);
  const before = await readFile(f.exclude, 'utf8');
  const report = await checkInstallation(f);
  assert.equal(report.ok, true);
  assert.equal(report.project, f.project);
  assert.equal(report.checks.find(c => c.name === 'adapter-registration').status, 'pass');
  assert.equal(report.checks.find(c => c.name === 'herdr-environment').status, 'warn');
  assert.equal(report.checks.find(c => c.name === 'live-readiness').status, 'warn');
  assert.equal(f.git('status', '--porcelain'), '');
  assert.equal(await readFile(f.exclude, 'utf8'), before);
});

test('state exclusions are required and cannot hide already tracked state', async t => {
  const f = await fixture(t);
  await writeFile(f.exclude, '');
  assert.equal((await checkInstallation(f)).ok, false);
  await mkdir(path.join(f.project, '.forgeflow'));
  await writeFile(path.join(f.project, '.forgeflow/state.json'), '{}');
  f.git('add', '.forgeflow');
  await writeFile(f.exclude, '.forgeflow/\n.pi/herdr-orchestrator/\n');
  const check = (await checkInstallation(f)).checks.find(c => c.name === 'local-state:.forgeflow');
  assert.equal(check.status, 'fail');
  assert.match(check.detail, /tracked/);
});

test('project registration resolves from .pi and malformed settings fail without leaking values', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.agentDir, 'settings.json'), '{}');
  const pi = path.join(f.project, '.pi');
  await mkdir(pi);
  const filename = path.join(pi, 'settings.json');
  await writeFile(filename, JSON.stringify({ extensions: [path.relative(pi, extension)] }));
  assert.equal((await checkInstallation(f)).checks.find(c => c.name === 'adapter-registration').status, 'pass');
  await writeFile(filename, '{"secret": "never-print-this", broken');
  const report = await checkInstallation(f);
  assert.equal(report.ok, false);
  assert.equal(JSON.stringify(report).includes('never-print-this'), false);
});

test('CLI reports JSON, rejects invalid args and fails for a non-checkout', async t => {
  const f = await fixture(t);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  let result = run('--project', f.project, '--agent-dir', f.agentDir, '--json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).project, f.project);
  assert.equal(run('--project').status, 2);
  assert.equal(run('--bogus').status, 2);
  result = run('--project', f.agentDir, '--agent-dir', f.agentDir, '--json');
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).ok, false);
});
