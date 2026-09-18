import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { loadPreview, buildPreview } from '../planner.js';
import { prepareLane, revalidate, verifyLane, reconcileLane } from '../prepare.js';
import { laneStatus } from '../status.js';
const env = { HERDR_ENV: '1', HERDR_PANE_ID: 'controller:p1', HERDR_WORKSPACE_ID: 'controller' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const profile = { provider: 'openai-codex', model: 'test-model', thinking: 'medium', auth: 'subscription' };
async function repo(cwd, content) {
  await mkdir(cwd, { recursive: true });
  git(cwd, 'init'); git(cwd, 'config', 'user.name', 'Test'); git(cwd, 'config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(cwd, 'source.txt'), content);
  git(cwd, 'add', 'source.txt'); git(cwd, 'commit', '-m', 'base');
}
async function fixture(t) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'multi repo ')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cwd = path.join(dir, 'workspace'); await repo(cwd, 'controller');
  await writeFile(path.join(cwd, '.git/info/exclude'), 'apps/\n.forgeflow/\n.pi/\n');
  const a = path.join(cwd, 'apps/a'), b = path.join(cwd, 'apps/b');
  await repo(a, 'application a'); await repo(b, 'application b');
  const wa = path.join(dir, 'worker a'), wb = path.join(dir, 'worker b');
  git(a, 'worktree', 'add', '-b', 'writer-a', wa); git(b, 'worktree', 'add', '-b', 'writer-b', wb);
  const task = (id, repoCwd, worktreeCwd) => ({ id, repoCwd, worktreeCwd, objective: `Update ${id}`, files: ['source.txt'], checks: ['Inspect source'], launchProfile: profile });
  const brief = { version: 1, objective: 'Coordinate applications', acceptance: ['Scoped changes'], tasks: [task('a', a, wa), task('b', b, wb)] };
  await mkdir(path.join(cwd, '.forgeflow'));
  const filename = path.join(cwd, '.forgeflow/brief.json');
  const save = async () => { await writeFile(filename, JSON.stringify(brief)); return loadPreview(filename, { cwd }); };
  const preview = await save();
  return { cwd, filename, preview, env, a, b, wa, wb, brief, save };
}

test('independent nested repositories prepare from one root and partition identical file scopes', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.preview.stages, [['a', 'b']]);
  const p = await prepareLane({ ...f, taskId: 'a' });
  assert.equal(p.repository.root, f.a); assert.equal(p.root, f.cwd); assert.equal(p.target, f.wa);
  assert.equal(p.targetBranch, 'writer-a'); assert.equal(p.planArguments.repoCwd, undefined);
  await revalidate(p, [], env);
  git(f.wa, 'checkout', '-b', 'changed-branch');
  await assert.rejects(revalidate(p, [], env), /changed since prepare/);
  f.brief.tasks = [f.brief.tasks[0]];
  f.brief.tasks[0].worktreeCwd = f.wb; f.preview = await f.save();
  await assert.rejects(prepareLane({ ...f, taskId: 'a' }), /different repository/);
  delete f.brief.tasks[0].repoCwd; f.brief.tasks[0].worktreeCwd = f.wa; f.preview = await f.save();
  await assert.rejects(prepareLane({ ...f, taskId: 'a' }), /different repository/);
});

test('repository aliases share scope ownership and explicit read-only targets require a worktree', async t => {
  const f = await fixture(t);
  f.brief.tasks[1].repoCwd = f.a;
  let preview = await f.save(); assert.deepEqual(preview.stages, [['a'], ['b']]);
  if (process.platform !== 'win32') {
    const alias = path.join(path.dirname(f.cwd), 'a-alias'); await symlink(f.a, alias);
    f.brief.tasks[1].repoCwd = alias; preview = await f.save(); assert.deepEqual(preview.stages, [['a'], ['b']]);
  }
  f.brief.tasks = [{ ...f.brief.tasks[0], readOnly: true }]; delete f.brief.tasks[0].worktreeCwd;
  preview = await f.save(); assert.equal(preview.workflows[0].planArguments, null);
  assert.throws(() => buildPreview({ ...f.brief, tasks: [{ ...f.brief.tasks[0], repoCwd: 'relative' }] }), /absolute/);
});

async function complete(f, prepared) {
  await writeFile(path.join(f.wa, 'source.txt'), 'verified change');
  git(f.wa, 'add', 'source.txt'); git(f.wa, 'commit', '-m', 'change');
  const commit = git(f.wa, 'rev-parse', 'HEAD');
  const mapped = { ...prepared, kind: 'planned', workflowId: 'herdr-nested' };
  const flow = { id: mapped.workflowId, cwd: f.wa, objective: prepared.planArguments.objective,
    taskBinding: { rootSessionPath: '/session', rootPaneId: env.HERDR_PANE_ID, workspaceId: env.HERDR_WORKSPACE_ID },
    worktreeBinding: { repoParent: { checkoutPath: f.a, workspaceId: 'application-workspace' } },
    lanes: prepared.planArguments.lanes.map(lane => ({ ...lane, completionReceipt: { id: 'receipt', summary: 'Complete' } })) };
  await mkdir(path.join(f.cwd, '.pi/herdr-orchestrator'), { recursive: true });
  const manifestPath = path.join(f.cwd, '.pi/herdr-orchestrator/manifest.json');
  const save = () => writeFile(manifestPath, JSON.stringify({ version: 2, workflows: [flow] })); await save();
  return { mapped, commit, flow, save };
}

test('verification integrates into the application checkout and cross-repo dependencies use its evidence', async t => {
  const f = await fixture(t); f.brief.tasks[1].dependsOn = ['a']; f.preview = await f.save();
  await writeFile(path.join(f.cwd, 'source.txt'), 'unrelated controller edit');
  const prepared = await prepareLane({ ...f, taskId: 'a' });
  const done = await complete(f, prepared);
  const options = { mapped: done.mapped, cwd: f.cwd, commit: done.commit, evidence: 'Independently inspected change' };
  await assert.rejects(verifyLane(options), /not integrated/);
  git(f.a, 'merge', '--ff-only', done.commit);
  const verified = await verifyLane(options);
  const next = await prepareLane({ ...f, taskId: 'b', records: [verified] });
  assert.equal(next.repository.root, f.b);
  await assert.rejects(prepareLane({ ...f, taskId: 'b', records: [{ ...verified, repository: undefined }] }), /matching repository verification/);
  const report = await laneStatus({ ...f, records: [done.mapped, verified], sessionFile: '/session' });
  assert.equal(report.tasks[0].owner.root, f.cwd); assert.equal(report.tasks[0].repoCwd, f.a);
  assert.equal(report.tasks[0].blockers.length, 0);
});

test('reconciliation separates controller session identity from native repository workspace ownership', async t => {
  const f = await fixture(t), prepared = await prepareLane({ ...f, taskId: 'a' });
  await writeFile(path.join(f.cwd, 'journal.txt'), 'unrelated controller journal');
  const done = await complete(f, prepared);
  const options = { ...f, taskId: 'a', workflowId: done.mapped.workflowId, sessionFile: '/session' };
  const mapped = await reconcileLane(options); assert.equal(mapped.repository.root, f.a);
  done.flow.taskBinding.rootPaneId = 'foreign'; await done.save();
  await assert.rejects(reconcileLane(options), /another root/);
  done.flow.taskBinding.rootPaneId = env.HERDR_PANE_ID;
  done.flow.worktreeBinding.repoParent.checkoutPath = f.b; await done.save();
  await assert.rejects(reconcileLane(options), /different repository/);
});

test('explicit repoCwd tolerates staged, unstaged and untracked controller edits without changing them', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.cwd, 'source.txt'), 'staged controller instruction');
  git(f.cwd, 'add', 'source.txt');
  await writeFile(path.join(f.cwd, 'source.txt'), 'later controller instruction');
  await writeFile(path.join(f.cwd, 'journal.txt'), 'local journal');
  const before = git(f.cwd, 'diff', '--cached');
  const prepared = await prepareLane({ ...f, taskId: 'a' });
  await writeFile(path.join(f.cwd, 'journal.txt'), 'concurrent journal update');
  await revalidate(prepared, [], env);
  assert.equal(git(f.cwd, 'diff', '--cached'), before);
  assert.equal(await readFile(path.join(f.cwd, 'source.txt'), 'utf8'), 'later controller instruction');
  assert.equal(await readFile(path.join(f.cwd, 'journal.txt'), 'utf8'), 'concurrent journal update');
  for (const dir of [f.a, f.wa]) {
    await writeFile(path.join(dir, 'unexpected.txt'), 'dirty');
    await assert.rejects(prepareLane({ ...f, taskId: 'a' }), /dirty/);
    await assert.rejects(revalidate(prepared, [], env), /dirty/);
    await rm(path.join(dir, 'unexpected.txt'));
  }
  git(f.cwd, 'commit', '-m', 'other agent committed controller instructions');
  await assert.rejects(revalidate(prepared, [], env), /changed since prepare/);
});

test('implicit controller repositories and explicit aliases of the controller still require cleanliness', async t => {
  const f = await fixture(t);
  f.brief.tasks = [{ ...f.brief.tasks[0], readOnly: true }];
  delete f.brief.tasks[0].repoCwd; delete f.brief.tasks[0].worktreeCwd;
  f.preview = await f.save();
  await writeFile(path.join(f.cwd, 'source.txt'), 'dirty');
  await assert.rejects(prepareLane({ ...f, taskId: 'a' }), /dirty/);
  const alias = path.join(path.dirname(f.cwd), 'controller-alias');
  await symlink(f.cwd, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const worker = path.join(path.dirname(f.cwd), 'controller-worker');
  git(f.cwd, 'worktree', 'add', '-b', 'controller-worker', worker);
  f.brief.tasks[0].repoCwd = alias; f.brief.tasks[0].worktreeCwd = worker; f.preview = await f.save();
  await assert.rejects(prepareLane({ ...f, taskId: 'a' }), /dirty/);
});

test('same-repository dependencies still require integration into the dependent worktree', async t => {
  const f = await fixture(t);
  const second = path.join(path.dirname(f.cwd), 'second-a'); git(f.a, 'worktree', 'add', '-b', 'second-a', second);
  f.brief.tasks[1].repoCwd = f.a; f.brief.tasks[1].worktreeCwd = second; f.preview = await f.save();
  const prepared = await prepareLane({ ...f, taskId: 'a' }), done = await complete(f, prepared);
  git(f.a, 'merge', '--ff-only', done.commit);
  const verified = await verifyLane({ mapped: done.mapped, cwd: f.cwd, commit: done.commit, evidence: 'Reviewed diff' });
  await assert.rejects(prepareLane({ ...f, taskId: 'b', records: [verified] }), /not integrated/);
  git(second, 'merge', '--ff-only', done.commit);
  assert.equal((await prepareLane({ ...f, taskId: 'b', records: [verified] })).target, second);
});

test('dirty integration checkouts and branch changes cannot pass verification', async t => {
  const f = await fixture(t), prepared = await prepareLane({ ...f, taskId: 'a' });
  const done = await complete(f, prepared); git(f.a, 'merge', '--ff-only', done.commit);
  const options = { mapped: done.mapped, cwd: f.cwd, commit: done.commit, evidence: 'Reviewed' };
  await writeFile(path.join(f.a, 'unexpected.txt'), 'dirty');
  await assert.rejects(verifyLane(options), /dirty/);
  await rm(path.join(f.a, 'unexpected.txt'));
  git(f.a, 'checkout', '-b', 'wrong-integration-branch');
  await assert.rejects(verifyLane(options), /branch changed/);
});
