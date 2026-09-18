import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadPreview } from '../planner.js';
import { prepareLane } from '../prepare.js';
import { nativePreflight } from '../preflight.js';
import { nativeFixture } from './native-fixture.js';
import { checkContinuation } from '../continuation-readiness.js';

const env = { HERDR_ENV: '1', HERDR_PANE_ID: 'test:p1', HERDR_WORKSPACE_ID: 'test' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' });
async function fixture(t, manifestDirectory = '.pi/herdr-orchestrator') {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'continuation readiness ')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'root'), target = path.join(base, 'worker');
  await mkdir(root); git(root, 'init'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(root, 'file.txt'), 'base\n'); git(root, 'add', '.'); git(root, 'commit', '-m', 'base');
  git(root, 'worktree', 'add', '-b', 'worker', target);
  await writeFile(path.join(root, '.git/info/exclude'), '.pi/\n.baa-ton/herdr-orchestrator/\n');
  const filename = path.join(base, 'brief.json');
  await writeFile(filename, JSON.stringify({ version: 1, objective: 'Trial', acceptance: ['Correct'], tasks: [{ id: 'writer', objective: 'Update file', files: ['file.txt'], checks: ['Inspect'], worktreeCwd: target, launchProfile: { provider: 'openai-codex', model: 'gpt-5.5', thinking: 'medium', auth: 'subscription' } }] }));
  const preview = await loadPreview(filename, { cwd: root });
  const records = [{ kind: 'preview', sourcePath: preview.sourcePath, sourceSha256: preview.sourceSha256 }];
  const native = await nativeFixture({ root, target, manifestDirectory }, env);
  const options = { filename, cwd: root, records, env: native.env, sessionFile: native.sessionFile, exec: native.exec };
  const prepared = await prepareLane({ ...options, preview, taskId: 'writer' });
  const readiness = await nativePreflight({ prepared, ...native });
  records.push({ ...prepared, sessionFile: native.sessionFile, nativeReadiness: readiness });
  const manifest = path.join(root, manifestDirectory, 'manifest.json');
  await mkdir(path.dirname(manifest), { recursive: true });
  const workflow = { id: 'herdr-test', cwd: target, objective: prepared.planArguments.objective, status: 'planned', lanes: prepared.planArguments.lanes,
    taskBinding: { rootSessionPath: native.sessionFile, rootPaneId: env.HERDR_PANE_ID, workspaceId: env.HERDR_WORKSPACE_ID },
    worktreeBinding: { repoParent: { checkoutPath: root, workspaceId: 'source-workspace' } } };
  const save = () => writeFile(manifest, JSON.stringify({ workflows: [workflow] }));
  await save(); records.push({ ...records[1], kind: 'planned', workflowId: workflow.id });
  native.calls.length = 0;
  return { options, native, records, manifest, workflow, save, root, target };
}

for (const directory of ['.pi/herdr-orchestrator', '.baa-ton/herdr-orchestrator'])
test(`mapped planned readiness checks ${directory} without writing or bypassing duplicate-plan guard`, async t => {
  const f = await fixture(t, directory), before = await readFile(f.manifest), history = structuredClone(f.records);
  const report = await checkContinuation(f.options);
  assert.equal(report.readiness.state, 'passed', JSON.stringify(report));
  assert.equal(report.executed, false);
  assert.equal(report.authorization, 'not-assessed');
  assert.equal(report.readiness.runtimeQualification, 'not-checked');
  assert.deepEqual(f.native.calls.map(item => item.args.slice(0, 2)), [['agent', 'get'], ['worktree', 'list'], ['workspace', 'list']]);
  assert.deepEqual(await readFile(f.manifest), before); assert.deepEqual(f.records, history);
  await assert.rejects(prepareLane({ ...f.options, preview: f.records[0], taskId: 'writer' }), /already mapped/);
});

test('missing source, occupied target, foreign native session and dirty checkout block without repair', async t => {
  const f = await fixture(t), baseline = structuredClone(f.native.responses);
  for (const [change, pattern] of [
    [v => { delete v.worktree.source.source_workspace_id; }, /missing source_workspace_id/],
    [v => { v.worktree.worktrees[0].open_workspace_id = 'occupied'; }, /already has an open/],
    [v => { v.agent.agent.agent_session.value = 'foreign'; }, /Live root session differs/],
  ]) {
    Object.assign(f.native.responses, structuredClone(baseline)); change(f.native.responses);
    const report = await checkContinuation(f.options);
    assert.equal(report.readiness.state, 'blocked'); assert.match(report.readiness.blockers.join(' '), pattern);
  }
  Object.assign(f.native.responses, baseline);
  await writeFile(path.join(f.target, 'file.txt'), 'dirty\n');
  const report = await checkContinuation(f.options);
  assert.equal(report.readiness.state, 'blocked'); assert.match(report.readiness.blockers.join(' '), /dirty/);
});

test('wrong owner skips probes; changed durable source or concurrent manifest blocks', async t => {
  const f = await fixture(t);
  const wrong = await checkContinuation({ ...f.options, sessionFile: 'foreign' });
  assert.equal(wrong.readiness.state, 'not-checked'); assert.equal(f.native.calls.length, 0);
  f.workflow.worktreeBinding.repoParent.workspaceId = 'different'; await f.save();
  assert.match((await checkContinuation(f.options)).readiness.blockers.join(' '), /source binding differs/);
  f.workflow.worktreeBinding.repoParent.workspaceId = 'source-workspace'; await f.save();
  const exec = async (...args) => { const result = await f.native.exec(...args); await writeFile(f.manifest, (await readFile(f.manifest, 'utf8')) + '\n'); return result; };
  assert.match((await checkContinuation({ ...f.options, exec })).readiness.blockers.join(' '), /Evidence changed/);
});

test('unmapped preparation uses read-only source checks and stale planned HEAD is rejected', async t => {
  const f = await fixture(t);
  const mapped = f.records.pop();
  f.records.pop();
  await writeFile(f.manifest, JSON.stringify({ workflows: [] }));
  const preparing = await checkContinuation(f.options);
  assert.equal(preparing.proposedStep.code, 'prepare');
  assert.equal(preparing.readiness.state, 'passed');
  delete f.native.responses.worktree.source.source_workspace_id;
  assert.match((await checkContinuation(f.options)).readiness.blockers.join(' '), /missing source_workspace_id/);
  f.native.responses.worktree.source.source_workspace_id = 'source-workspace';
  f.records.push({ ...mapped, kind: 'prepared' }, mapped); await f.save();
  await writeFile(path.join(f.target, 'file.txt'), 'new head\n');
  git(f.target, 'add', '.'); git(f.target, 'commit', '-m', 'changed');
  assert.match((await checkContinuation(f.options)).readiness.blockers.join(' '), /changed since preparation/);
});
