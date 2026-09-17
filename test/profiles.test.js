import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildPreview, loadPreview, renderPreview } from '../planner.js';

const launchProfile = { provider: 'anthropic', model: 'test-model', thinking: 'medium', auth: 'subscription' };
const config = { version: 1, profiles: { quick: { agentKind: 'pi', launchProfile }, review: { agentKind: 'claude', launchProfile }, planning: { agentKind: 'pi', launchProfile } } };
const task = { id: 'change', objective: 'Update text', files: ['README.md'], checks: ['Read text'], worktreeCwd: '/tmp/writer', taskProfile: 'quick' };
const brief = { version: 1, objective: 'Trial', acceptance: ['Text is correct'], tasks: [task] };

test('named profiles resolve exact settings and preserve read-only scheduling', () => {
  const input = structuredClone(brief);
  input.tasks.push({ ...task, id: 'review', taskProfile: 'review', readOnly: false, worktreeCwd: undefined });
  const preview = buildPreview(input, {}, config);
  const [writer, reviewer] = preview.workflows;
  assert.deepEqual(writer.planArguments.lanes[0].launchProfile, launchProfile);
  assert.equal(writer.planArguments.lanes[0].agentKind, 'pi');
  assert.equal(reviewer.planArguments.lanes[0].agentKind, 'claude');
  assert.equal(reviewer.readOnly, true);
  assert.deepEqual(reviewer.afterVerifiedAndIntegrated, ['change']);
  assert.equal('taskProfile' in reviewer.planArguments.lanes[0], false);
  assert.match(renderPreview(preview), /Task profile: review/);
  assert.equal(input.tasks[1].readOnly, false, 'input remains unchanged');
});

test('ambiguous or incomplete named profiles fail instead of substituting', () => {
  const preview = (overrides, configured = config) => buildPreview({ ...brief, tasks: [{ ...task, ...overrides }] }, {}, configured);
  assert.throws(() => preview({ taskProfile: 'unknown' }), /Unknown taskProfile/);
  assert.throws(() => preview({ launchProfile }), /not both/);
  assert.throws(() => preview({ agentKind: 'codex' }), /conflicts/);
  assert.throws(() => preview({}, { version: 1, profiles: {} }), /no exact launchProfile/);
  assert.throws(() => preview({}, { version: 2, profiles: {} }), /version 1/);
  for (const bad of [{ ...launchProfile, auth: 'api-key' }, { ...launchProfile, thinking: 'invented' }, { ...launchProfile, model: '' }]) {
    assert.throws(() => preview({}, { version: 1, profiles: { quick: { launchProfile: bad } } }));
  }
  const restricted = { version: 1, profiles: { quick: { readOnly: true, launchProfile } } };
  assert.equal(preview({ readOnly: false }, restricted).workflows[0].readOnly, true);
});

test('configuration resolves from the explicit root and participates in snapshot identity', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'profile root '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.baa-ton'));
  await mkdir(path.join(root, '.forgeflow'));
  const filename = path.join(root, '.forgeflow/brief.json');
  const configPath = path.join(root, '.baa-ton/config.json');
  await writeFile(filename, JSON.stringify(brief));
  await assert.rejects(loadPreview(filename, { cwd: root }), /Cannot read task profiles/);
  await writeFile(configPath, JSON.stringify(config));
  const first = await loadPreview(filename, { cwd: root });
  assert.equal(first.profileConfig.path, configPath);
  assert.match(renderPreview(first), /Profile config SHA-256/);
  await writeFile(configPath, JSON.stringify(config) + '\n');
  const second = await loadPreview(filename, { cwd: root });
  assert.equal(second.briefSha256, first.briefSha256);
  assert.notEqual(second.sourceSha256, first.sourceSha256);
  await writeFile(configPath, '{invalid');
  await assert.rejects(loadPreview(filename, { cwd: root }), /Invalid JSON/);
  await writeFile(filename, JSON.stringify({ ...brief, tasks: [{ ...task, taskProfile: undefined, launchProfile }] }));
  assert.equal((await loadPreview(filename, { cwd: root })).profileConfig, undefined, 'explicit profiles do not depend on project config');
});
