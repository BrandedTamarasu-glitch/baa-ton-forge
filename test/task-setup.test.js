import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { previewTaskSetup, applyTaskSetup } from '../task-setup.js';
import { prepareLane } from '../prepare.js';
import { nativePreflight } from '../preflight.js';
import { nativeFixture } from './native-fixture.js';
import adapter from '../extension.js';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const env = { HERDR_ENV: '1', HERDR_PANE_ID: 'p1', HERDR_WORKSPACE_ID: 'w1' };
async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'forge setup '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'app'); await mkdir(root);
  git(root, 'init'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(root, 'file.txt'), 'baseline'); git(root, 'add', '.'); git(root, 'commit', '-m', 'baseline');
  const assignment = { agentKind: 'pi', launchProfile: { provider: 'test-provider', model: 'exact-user-model', thinking: 'low', auth: 'subscription' } };
  const input = { name: 'example', objective: 'Improve the file', acceptance: ['File is improved'], files: ['file.txt'], checks: ['Inspect the file'], repoCwd: root, writer: assignment, reviewer: assignment };
  return { base, root, input };
}

test('guided setup creates a linked writer and a reviewer dependency, then passes existing native preparation', async t => {
  const f = await fixture(t), head = git(f.root, 'rev-parse', 'HEAD');
  const before = await readdir(f.base);
  const draft = await previewTaskSetup(f.input, f.root);
  assert.deepEqual(await readdir(f.base), before, 'preview creates no filesystem resources');
  const result = await applyTaskSetup(draft, f.root);
  assert.equal(git(f.root, 'status', '--porcelain'), '');
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(result.worktree, 'branch', '--show-current'), 'forge/example');
  assert.deepEqual(result.preview.stages, [['writer'], ['review']]);
  assert.equal(result.preview.workflows[1].planArguments.worktreeCwd, result.reviewWorktree);
  assert.notEqual(result.reviewWorktree, result.worktree);
  const opts = { filename: result.filename, cwd: f.root, preview: result.preview, env };
  const prepared = await prepareLane({ ...opts, taskId: 'writer' });
  const native = await nativeFixture({ root: f.root, target: result.worktree }, env);
  const readiness = await nativePreflight({ prepared, sessionFile: native.sessionFile, env: native.env, exec: native.exec });
  assert.equal(readiness.source.workspaceId, 'source-workspace');
  await assert.rejects(prepareLane({ ...opts, taskId: 'review' }), /no root verification/);
  await writeFile(path.join(result.worktree, 'file.txt'), 'implemented');
  git(result.worktree, 'add', '.'); git(result.worktree, 'commit', '-m', 'implement');
  const commit = git(result.worktree, 'rev-parse', 'HEAD');
  const verified = { kind: 'verified', taskId: 'writer', root: prepared.root, sourcePath: result.preview.sourcePath, sourceSha256: result.preview.sourceSha256, repository: prepared.repository, commit };
  await assert.rejects(prepareLane({ ...opts, taskId: 'review', records: [verified] }), /not integrated/);
  git(f.root, 'merge', '--ff-only', commit);
  await assert.rejects(prepareLane({ ...opts, taskId: 'review', records: [verified] }), /not integrated/);
  git(result.reviewWorktree, 'merge', '--ff-only', commit);
  const review = await prepareLane({ ...opts, taskId: 'review', records: [verified] });
  assert.equal(review.planArguments.lanes[0].readOnly, true);
  native.responses.worktree.worktrees = [
    { path: result.worktree, open_workspace_id: 'preserved-writer-workspace' },
    { path: result.reviewWorktree },
  ];
  await nativePreflight({ prepared: review, sessionFile: native.sessionFile, env: native.env, exec: native.exec });
  await assert.rejects(applyTaskSetup(draft, f.root), /already exists/);
  assert.equal(JSON.parse(await readFile(result.journal)).state, 'complete');
});

test('changed application HEAD, dirty checkout, collision and unsafe inputs fail before creation', async t => {
  const f = await fixture(t), draft = await previewTaskSetup(f.input, f.root);
  await writeFile(path.join(f.root, 'file.txt'), 'changed');
  await assert.rejects(applyTaskSetup(draft, f.root), /dirty/);
  git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'advance');
  await assert.rejects(applyTaskSetup(draft, f.root), /stale/);
  await assert.rejects(previewTaskSetup({ ...f.input, parentDirectory: f.root }, f.root), /outside/);
  await assert.rejects(previewTaskSetup({ ...f.input, name: '../escape' }, f.root), /Setup name/);
  await assert.rejects(previewTaskSetup({ ...f.input, files: ['../file'] }, f.root), /Invalid relative/);
  await assert.rejects(previewTaskSetup({ ...f.input, writer: {} }, f.root), /requires/);
  await assert.rejects(previewTaskSetup({ ...f.input, checks: ['x'.repeat(256 * 1024)] }, f.root), /exceeds/);
  git(f.root, 'branch', 'forge/example');
  await assert.rejects(previewTaskSetup(f.input, f.root), /already exists/);
  assert.deepEqual(await readdir(f.base), ['app']);
});

test('named profiles are exact, stale changes block apply, and dirty separate controllers are tolerated', async t => {
  const f = await fixture(t);
  const controller = path.join(f.base, 'controller'); await mkdir(controller);
  git(controller, 'init'); git(controller, 'config', 'user.name', 'Test'); git(controller, 'config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(controller, 'journal'), 'initial'); git(controller, 'add', '.'); git(controller, 'commit', '-m', 'controller');
  await mkdir(path.join(controller, '.baa-ton'));
  const configPath = path.join(controller, '.baa-ton/config.json');
  const config = { version: 1, profiles: { implementation: f.input.writer, review: { ...f.input.reviewer, readOnly: true } } };
  await writeFile(configPath, JSON.stringify(config));
  const input = { ...f.input, writer: { taskProfile: 'implementation' }, reviewer: { taskProfile: 'review' } };
  const draft = await previewTaskSetup(input, controller);
  assert.equal(draft.assignments[0].launchProfile.model, 'exact-user-model');
  config.profiles.implementation.launchProfile.model = 'another-model'; await writeFile(configPath, JSON.stringify(config));
  await assert.rejects(applyTaskSetup(draft, controller), /stale/);
  const fresh = await previewTaskSetup(input, controller);
  await writeFile(path.join(controller, 'journal'), 'unrelated concurrent edits');
  await applyTaskSetup(fresh, controller);
  assert.equal(await readFile(path.join(controller, 'journal'), 'utf8'), 'unrelated concurrent edits');
});

test('an earlier uncertain attempt is never retried or cleaned up', async t => {
  const f = await fixture(t), draft = await previewTaskSetup(f.input, f.root);
  const journalDir = path.join(draft.repository.commonDir, 'forgeflow-task-setup'); await mkdir(journalDir);
  const journal = path.join(journalDir, 'example.json'); await writeFile(journal, 'interrupted attempt');
  await assert.rejects(applyTaskSetup(draft, f.root), /attempt already exists/);
  assert.equal(await readFile(journal, 'utf8'), 'interrupted attempt');
  assert.deepEqual(await readdir(f.base), ['app']);
});

test('native tools require the owning saved draft and persist the normal preview for preparation', async t => {
  const f = await fixture(t), entries = [], tools = new Map();
  const pi = { registerCommand() {}, registerTool(def) { tools.set(def.name, def); }, appendEntry(customType, data) { entries.push({ type: 'custom', customType, data }); } };
  adapter(pi);
  let session = 'owning-session';
  const ctx = { cwd: f.root, sessionManager: { getBranch: () => entries, getSessionFile: () => session } };
  const run = (name, params) => tools.get(name).execute('call', params, undefined, undefined, ctx);
  const draft = (await run('forgeflow_setup_preview', f.input)).details;
  session = 'other-session';
  await assert.rejects(run('forgeflow_setup_apply', { draftId: draft.draftId }), /owning Pi session/);
  session = 'owning-session';
  const result = (await run('forgeflow_setup_apply', { draftId: draft.draftId })).details;
  assert.ok(entries.some(entry => entry.data.kind === 'preview' && entry.data.sourceSha256 === result.preview.sourceSha256));
  assert.ok(entries.some(entry => entry.data.kind === 'setup-complete'));
});

test('a failed worktree creation preserves an inspectable attempt and never writes a success brief', async t => {
  const f = await fixture(t);
  // A namespace collision makes Git reject creation after the journal starts.
  git(f.root, 'branch', 'forge');
  const draft = await previewTaskSetup(f.input, f.root);
  await assert.rejects(applyTaskSetup(draft, f.root), /Task setup stopped/);
  const journal = path.join(draft.repository.commonDir, 'forgeflow-task-setup/example.json');
  assert.equal(JSON.parse(await readFile(journal)).state, 'started');
  assert.deepEqual(await readdir(draft.directory), []);
  assert.equal(git(f.root, 'status', '--porcelain'), '');
  await assert.rejects(applyTaskSetup(draft, f.root), /already exists/);
});


test('setup preserves explicit complete acceptance scope through preview and apply', async t => {
  const f = await fixture(t);
  const acceptanceScopes = [{ requirementId: 'acceptance-1', taskIds: ['review', 'writer'], phase: 'final' }];
  const draft = await previewTaskSetup({ ...f.input, acceptanceScopes }, f.root);
  const result = await applyTaskSetup(draft, f.root);
  assert.deepEqual(JSON.parse(await readFile(result.filename)).acceptanceScopes, acceptanceScopes);
  assert.deepEqual(result.preview.acceptanceScopes, acceptanceScopes);
});
