import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { nativeFixture } from './native-fixture.js';
import { nativePreflight } from '../preflight.js';
import { loadPreview } from '../planner.js';
import { prepareLane } from '../prepare.js';
import adapter from '../extension.js';
import { checkContinuation } from '../continuation-readiness.js';

const env = { HERDR_ENV: '1', HERDR_PANE_ID: 'fixture:p1', HERDR_WORKSPACE_ID: 'fixture' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function fixture(t, manifestDirectory = '.pi/herdr-orchestrator') {
  const base = await mkdtemp(path.join(os.tmpdir(), 'forge nested source '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'controller'), repository = path.join(root, 'apps', 'sample');
  const target = path.join(base, 'writer with spaces');
  for (const dir of [root, repository]) {
    await mkdir(dir, { recursive: true }); git(dir, 'init');
    git(dir, 'config', 'user.name', 'Test'); git(dir, 'config', 'user.email', 'test@example.invalid');
    await writeFile(path.join(dir, 'README.md'), '# Trial\n');
    git(dir, 'add', 'README.md'); git(dir, 'commit', '-m', 'Baseline');
  }
  await writeFile(path.join(root, '.git/info/exclude'), 'apps/\n.pi/\n.baa-ton/herdr-orchestrator/\n');
  git(repository, 'worktree', 'add', '-b', 'writer', target);
  const filename = path.join(base, 'brief.json');
  await writeFile(filename, JSON.stringify({ version: 1, objective: 'Nested test', acceptance: ['Scoped change'], tasks: [{
    id: 'writer', objective: 'Update README', files: ['README.md'], checks: ['Inspect diff'], repoCwd: repository, worktreeCwd: target,
    agentKind: 'pi', launchProfile: { provider: 'openai-codex', model: 'gpt-5.5', thinking: 'medium', auth: 'subscription' },
  }] }));
  const prepared = await prepareLane({ filename, taskId: 'writer', cwd: root, env, preview: await loadPreview(filename, { cwd: root }) });
  const native = await nativeFixture({ root, target, manifestDirectory }, env);
  Object.assign(native.responses.worktree.source, { source_checkout_path: repository, repo_root: repository, repo_key: path.join(repository, '.git') });
  delete native.responses.worktree.source.source_workspace_id;
  native.responses.workspace.workspaces = [];
  let creations = 0;
  const create = () => {
    const workspace_id = `native-source-${++creations}`;
    native.responses.worktree.source.source_workspace_id = workspace_id;
    native.responses.workspace.workspaces.push({ workspace_id, worktree: { repo_key: path.join(repository, '.git'), checkout_path: repository } });
    return { code: 0, stdout: JSON.stringify({ result: { workspace_id } }) };
  };
  const exec = async (binary, args) => {
    if (args[0] === 'workspace' && args[1] === 'create') {
      native.calls.push({ binary, args });
      assert.equal(args[3], prepared.repository.root); assert.equal(args.at(-1), '--no-focus');
      assert.equal(args.includes('--trust-repository'), false);
      return create();
    }
    return native.exec(binary, args);
  };
  const options = { prepared, sessionFile: native.sessionFile, env: native.env, exec, ensureSource: true };
  const auditDir = path.join(repository, '.git/forgeflow-source-workspaces');
  const audit = async () => JSON.parse(await readFile(path.join(auditDir, (await readdir(auditDir)).find(name => name.endsWith('.json'))), 'utf8'));
  return { root, repository, target, filename, prepared, native, options, exec, create, audit, auditDir, creations: () => creations };
}

test('nested source setup creates once, preserves roots and clean checkouts, and reuses native binding', async t => {
  const f = await fixture(t);
  const configBefore = await readFile(f.native.configPath);
  const headBefore = git(f.repository, 'rev-parse', 'HEAD');
  const first = await nativePreflight(f.options);
  const second = await nativePreflight(f.options);
  assert.deepEqual(first, second);
  assert.equal(first.source.workspaceId, 'native-source-1');
  assert.equal(f.creations(), 1);
  const audit = await f.audit();
  assert.equal(audit.attempts.length, 1);
  assert.equal(audit.attempts[0].status, 'bound');
  assert.deepEqual(audit.attempts[0].owner, first.root);
  assert.deepEqual(await readFile(f.native.configPath), configBefore);
  for (const dir of [f.root, f.repository, f.target]) assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(git(f.repository, 'rev-parse', 'HEAD'), headBefore);
  assert.equal(f.native.calls.some(call => ['bootstrap', 'start', 'close', 'open'].includes(call.args[1])), false);
});

test('root/session, target, read-only opt-out and inconsistent native inventory fail before creation', async t => {
  const f = await fixture(t);
  await assert.rejects(nativePreflight({ ...f.options, ensureSource: false }), /missing source_workspace_id/);
  f.native.responses.agent.agent.agent_session.value = 'foreign';
  await assert.rejects(nativePreflight(f.options), /Live root session/);
  f.native.responses.agent.agent.agent_session.value = f.native.sessionFile;
  f.native.responses.worktree.worktrees[0].open_workspace_id = 'occupied';
  await assert.rejects(nativePreflight(f.options), /already has an open/);
  delete f.native.responses.worktree.worktrees[0].open_workspace_id;
  f.native.responses.workspace.workspaces = [{ workspace_id: 'unbound-existing', worktree: { repo_key: path.join(f.repository, '.git'), checkout_path: f.repository } }];
  await assert.rejects(nativePreflight(f.options), /inventory disagrees/);
  assert.equal(f.creations(), 0);
});

test('canonical root manifest and worktree identity accept directory aliases without accepting foreign repositories', async t => {
  const f = await fixture(t);
  const alias = path.join(path.dirname(f.root), 'controller alias');
  const targetAlias = path.join(path.dirname(f.root), 'writer alias');
  await symlink(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(f.target, targetAlias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await loadPreview(f.filename, { cwd: alias })).sourceSha256,
    (await loadPreview(f.filename, { cwd: f.prepared.root })).sourceSha256);
  f.native.config.orchestrators[0].program.id = alias;
  f.native.config.orchestrators[0].program.parent_manifest_path = path.join(alias, '.pi/herdr-orchestrator/manifest.json');
  await writeFile(f.native.configPath, JSON.stringify(f.native.config));
  f.native.responses.worktree.worktrees[0].path = targetAlias;
  f.native.responses.worktree.source.source_checkout_path = path.join(alias, 'apps/sample');
  f.native.responses.worktree.source.repo_root = path.join(alias, 'apps/sample');
  const result = await nativePreflight(f.options);
  assert.equal(result.root.checkout, f.prepared.root);
  assert.equal(result.source.target, f.prepared.target);
  assert.equal(f.creations(), 1);
  f.native.responses.worktree.source.source_checkout_path = f.root;
  f.native.responses.worktree.source.repo_root = f.root;
  await assert.rejects(nativePreflight(f.options), /does not match the declared repository/);
});

test('uncertain creation is retained and never retried blindly; native discovery can reuse its actual effect', async t => {
  const f = await fixture(t);
  let calls = 0;
  const exec = async (binary, args) => {
    if (args[1] === 'create') { calls++; throw new Error('transport lost'); }
    return f.exec(binary, args);
  };
  await assert.rejects(nativePreflight({ ...f.options, exec }), /could not be confirmed.*transport lost/);
  assert.equal((await f.audit()).attempts[0].status, 'creating');
  await assert.rejects(nativePreflight({ ...f.options, exec }), /unresolved outcome/);
  assert.equal(calls, 1);
  f.create(); // Simulate the late native effect of the first request.
  assert.equal((await nativePreflight({ ...f.options, exec })).source.workspaceId, 'native-source-1');
  assert.equal(calls, 1);
});

test('concurrent preparations serialize creation and retries reuse the same workspace', async t => {
  const f = await fixture(t);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const exec = async (binary, args) => {
    if (args[1] === 'create') { entered(); await gate; }
    return f.exec(binary, args);
  };
  const first = nativePreflight({ ...f.options, exec });
  await started;
  try { await assert.rejects(nativePreflight(f.options), /already locked/); }
  finally { release(); }
  const result = await first;
  assert.deepEqual(await nativePreflight(f.options), result);
  assert.equal(f.creations(), 1);
});

test('wrong create response or missing resulting binding preserves resources and blocks duplicate retry', async t => {
  for (const wrongId of [true, false]) {
    const f = await fixture(t);
    const exec = async (binary, args) => {
      if (args[1] === 'create') {
        if (wrongId) f.create();
        return { code: 0, stdout: JSON.stringify({ result: { workspace_id: 'wrong-id' } }) };
      }
      return f.exec(binary, args);
    };
    await assert.rejects(nativePreflight({ ...f.options, exec }), /could not be confirmed/);
    assert.equal((await f.audit()).attempts[0].status, 'creating');
    if (!wrongId) await assert.rejects(nativePreflight(f.options), /unresolved outcome/);
  }
});

test('removed completed source may be replaced, but a still-live unbound source cannot be duplicated', async t => {
  const f = await fixture(t);
  await nativePreflight(f.options);
  delete f.native.responses.worktree.source.source_workspace_id;
  delete f.native.responses.workspace.workspaces[0].worktree;
  await assert.rejects(nativePreflight(f.options), /Previously created source workspace still exists/);
  f.native.responses.workspace.workspaces = [];
  assert.equal((await nativePreflight(f.options)).source.workspaceId, 'native-source-2');
  assert.equal((await f.audit()).attempts.length, 2);
});

for (const [directory, dual] of [['.pi/herdr-orchestrator', false], ['.baa-ton/herdr-orchestrator', false], ['.baa-ton/herdr-orchestrator', true], ['.pi/herdr-orchestrator', true]])
test(`native preparation and guarded planning use ${directory}${dual ? " with historical alternate" : ""}; submission never creates sources`, async t => {
  const f = await fixture(t, directory), entries = [], tools = new Map(), events = new Map();
  const manifestPath = path.join(f.prepared.root, directory, 'manifest.json');
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify({ version: 2, workflows: [] }));
  let alternate, historical;
  if (dual) {
    alternate = path.join(f.root, directory.startsWith('.baa-ton') ? '.pi/herdr-orchestrator/manifest.json' : '.baa-ton/herdr-orchestrator/manifest.json');
    historical = JSON.stringify({ version: 2, workflows: [], sessionLog: { kind: 'root', paneId: 'old:p1', workspaceId: 'old' } });
    await mkdir(path.dirname(alternate), { recursive: true }); await writeFile(alternate, historical);
    const aliasDir = path.join(path.dirname(f.root), 'session alias');
    await symlink(path.dirname(f.native.sessionFile), aliasDir, process.platform === 'win32' ? 'junction' : 'dir');
    f.native.responses.agent.agent.agent_session.value = path.join(aliasDir, path.basename(f.native.sessionFile));
    f.native.env.PI_SESSION_FILE = f.native.responses.agent.agent.agent_session.value;
  }
  const saved = Object.fromEntries(Object.keys(f.native.env).map(key => [key, process.env[key]]));
  Object.assign(process.env, f.native.env);
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  adapter({ exec: f.exec, registerTool: tool => tools.set(tool.name, tool), registerCommand() {}, on: (name, fn) => events.set(name, fn),
    appendEntry: (customType, data) => entries.push({ type: 'custom', customType, data }) });
  const ctx = { cwd: f.root, sessionManager: { getBranch: () => entries, getSessionFile: () => f.native.sessionFile }, ui: { notify() {} } };
  const call = (name, params) => tools.get(name).execute('call', params, undefined, undefined, ctx);
  await writeFile(path.join(f.root, 'README.md'), 'Unrelated controller instructions\n');
  git(f.root, 'add', 'README.md');
  await writeFile(path.join(f.root, 'README.md'), 'Concurrent controller instruction edit\n');
  await call('forgeflow_plan_lanes', { filename: f.filename });
  await assert.rejects(call('forgeflow_prepare_lane', { filename: f.filename, taskId: 'writer', createSourceWorkspace: false }), /missing source_workspace_id/);
  assert.equal(entries.at(-1).data.kind, 'preview');
  const prepared = (await call('forgeflow_prepare_lane', { filename: f.filename, taskId: 'writer' })).details;
  const event = { toolName: 'herdr_plan', toolCallId: 'plan', input: prepared.planArguments };
  delete f.native.responses.worktree.source.source_workspace_id;
  f.native.responses.workspace.workspaces = [];
  assert.equal((await events.get('tool_call')(event, ctx)).block, true);
  assert.equal(f.creations(), 1);
  assert.equal(entries.at(-1).data.kind, 'prepared');
  f.native.responses.worktree.source.source_workspace_id = 'native-source-1';
  f.native.responses.workspace.workspaces = [{ workspace_id: 'native-source-1' }];
  await writeFile(path.join(f.root, 'journal.txt'), 'Concurrent untracked controller journal');
  assert.equal(await events.get('tool_call')(event, ctx), undefined);
  assert.equal(entries.at(-1).data.kind, 'planning');
  assert.equal(entries.at(-1).data.manifestSnapshot.exists, true);
  assert.equal(entries.at(-1).data.manifestSnapshot.path, manifestPath);
  // Fixture transport result, not a live Baa-ton qualification.
  events.get('tool_result')({ ...event, details: { workflow: { id: 'herdr-test', cwd: prepared.target } } }, ctx);
  assert.equal(entries.at(-1).data.kind, 'planned');
  if (dual) assert.equal(await readFile(alternate, 'utf8'), historical);
  assert.equal(f.creations(), 1);
  await writeFile(manifestPath, JSON.stringify({ workflows: [{ id: 'herdr-test', status: 'planned', cwd: prepared.target,
    objective: prepared.planArguments.objective, lanes: prepared.planArguments.lanes,
    taskBinding: { rootPaneId: env.HERDR_PANE_ID, workspaceId: env.HERDR_WORKSPACE_ID, rootSessionPath: f.native.responses.agent.agent.agent_session.value },
    worktreeBinding: { repoParent: { checkoutPath: prepared.repository.root, workspaceId: 'native-source-1' } } }] }));
  const report = await checkContinuation({ filename: f.filename, cwd: f.root, records: entries.map(item => item.data),
    sessionFile: f.native.sessionFile, env: f.native.env, exec: async (...args) => {
      await writeFile(path.join(f.root, 'journal.txt'), 'Concurrent journal edit during native inspection');
      return f.exec(...args);
    } });
  assert.equal(report.readiness.state, 'passed', JSON.stringify(report));
  assert.match(report.readiness.checks[0], /unrelated controller edits allowed/);
  assert.equal(await readFile(path.join(f.root, 'README.md'), 'utf8'), 'Concurrent controller instruction edit\n');
  assert.notEqual(git(f.root, 'diff', '--cached'), '');
});

test('bad native or environment session identity blocks before automatic source creation', async t => {
  const f = await fixture(t), original = f.native.sessionFile;
  for (const value of [path.join(path.dirname(original), 'other.jsonl'), `${original}\u0007`]) {
    f.native.responses.agent.agent.agent_session.value = value;
    await assert.rejects(nativePreflight(f.options), /Live root session differs/);
    assert.equal(f.creations(), 0);
  }
  f.native.responses.agent.agent.agent_session.value = original;
  f.native.env.PI_SESSION_FILE = `${original}\u0002`;
  await assert.rejects(nativePreflight(f.options), /Control characters detected/);
  assert.equal(f.creations(), 0);
});
