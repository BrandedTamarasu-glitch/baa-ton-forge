import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadPreview } from '../planner.js';
import { prepareLane, revalidate, verifyLane, reconcileLane } from '../prepare.js';
import adapter from '../extension.js';

const env = { HERDR_ENV: '1', HERDR_PANE_ID: 'test:p1', HERDR_WORKSPACE_ID: 'test' };
function git(cwd, ...args) { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'lane prepare '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'root'), target = path.join(base, 'writer');
  await mkdir(root);
  git(root, 'init');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(root, 'source.txt'), 'baseline');
  git(root, 'add', 'source.txt');
  git(root, 'commit', '-m', 'baseline');
  git(root, 'worktree', 'add', '-b', 'writer', target);
  await writeFile(path.join(root, '.git/info/exclude'), '.pi/\n');
  const filename = path.join(base, 'brief.json');
  const profile = { provider: 'openai-codex', model: 'gpt-5.5', thinking: 'medium', auth: 'subscription' };
  const task = { id: 'writer', objective: 'Change text', files: ['source.txt'], checks: ['Inspect text'], worktreeCwd: target, launchProfile: profile };
  const brief = { version: 1, objective: 'Trial', acceptance: ['Text is correct'], tasks: [task] };
  await writeFile(filename, JSON.stringify(brief));
  return { root, target, filename, brief, preview: await loadPreview(filename), cwd: root, taskId: 'writer', env };
}

test('prepare binds checkout and brief; revalidation detects dirty files, head and identity changes', async t => {
  const f = await fixture(t);
  const prepared = await prepareLane(f);
  assert.equal(prepared.target, f.target);
  assert.equal(prepared.targetHead, git(f.target, 'rev-parse', 'HEAD'));
  await revalidate(prepared, [], env);
  await assert.rejects(revalidate(prepared, [], { ...env, HERDR_PANE_ID: 'other:p1' }), /pane changed/);
  await writeFile(path.join(f.target, 'source.txt'), 'changed');
  await assert.rejects(revalidate(prepared, [], env), /dirty/);
  git(f.target, 'add', 'source.txt'); git(f.target, 'commit', '-m', 'change');
  await assert.rejects(revalidate(prepared, [], env), /changed since prepare/);
});

test('rejects stale previews, missing identity, wrong writer checkout, and duplicate plans', async t => {
  const f = await fixture(t);
  await assert.rejects(prepareLane({ ...f, env: {} }), /real Herdr pane/);
  await assert.rejects(prepareLane({ ...f, preview: undefined }), /forgeflow-plan-lanes/);
  const prepared = await prepareLane(f);
  await assert.rejects(prepareLane({ ...f, records: [{ ...prepared, kind: 'planned', workflowId: 'herdr-existing' }] }), /already mapped/);
  await writeFile(f.filename, (await readFile(f.filename, 'utf8')) + '\n');
  await assert.rejects(prepareLane(f), /changed/);
  f.brief.tasks[0].worktreeCwd = f.root;
  await writeFile(f.filename, JSON.stringify(f.brief));
  await assert.rejects(prepareLane({ ...f, preview: await loadPreview(f.filename) }), /distinct linked/);
});

test('prepare rejects tasks without an explicit launch profile before any workflow exists', async t => {
  const f = await fixture(t);
  delete f.brief.tasks[0].launchProfile;
  for (const readOnly of [false, true]) {
    f.brief.tasks[0].readOnly = readOnly;
    await writeFile(f.filename, JSON.stringify(f.brief));
    await assert.rejects(prepareLane({ ...f, preview: await loadPreview(f.filename) }), /no launchProfile; add one to the brief task/);
  }
});

test('dependencies require matching verification and commit ancestry in target', async t => {
  const f = await fixture(t);
  f.brief.tasks.push({ id: 'review', objective: 'Review text', readOnly: true, files: ['source.txt'], checks: ['Inspect diff'], launchProfile: f.brief.tasks[0].launchProfile });
  await writeFile(f.filename, JSON.stringify(f.brief));
  f.preview = await loadPreview(f.filename);
  await assert.rejects(prepareLane({ ...f, taskId: 'review' }), /no root verification/);
  const prepared = await prepareLane(f);
  const record = { ...prepared, kind: 'verified', commit: prepared.targetHead };
  assert.equal((await prepareLane({ ...f, taskId: 'review', records: [record] })).taskId, 'review');
  await assert.rejects(prepareLane({ ...f, taskId: 'review', records: [{ ...record, sourceSha256: 'stale' }] }), /no root verification/);
  await writeFile(path.join(f.target, 'source.txt'), 'new');
  git(f.target, 'add', 'source.txt'); git(f.target, 'commit', '-m', 'new');
  await assert.rejects(prepareLane({ ...f, taskId: 'review', records: [{ ...record, commit: git(f.target, 'rev-parse', 'HEAD') }] }), /not integrated/);
});

test('verification requires a durable receipt, exact lane HEAD and integrated commit', async t => {
  const f = await fixture(t);
  const mapped = { ...await prepareLane(f), kind: 'planned', workflowId: 'herdr-test' };
  const dir = path.join(f.root, '.pi/herdr-orchestrator');
  await mkdir(dir, { recursive: true });
  const workflow = { id: mapped.workflowId, cwd: f.target, lanes: [{}] };
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ workflows: [workflow] }));
  const options = { mapped, cwd: f.root, commit: mapped.targetHead, evidence: 'Independently inspected text: pass' };
  await assert.rejects(verifyLane(options), /receipts/);
  workflow.lanes[0].completionReceipt = { id: 'receipt-1', summary: 'done', delivery: 'delivered' };
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ workflows: [workflow] }));
  assert.equal((await verifyLane(options)).kind, 'verified');
  await assert.rejects(verifyLane({ ...options, commit: '0'.repeat(40) }), /HEAD/);
});

test('extension records exact successful plan mapping and blocks changed arguments', async t => {
  const f = await fixture(t);
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const commands = new Map(), events = new Map(), entries = [];
  const notifications = [];
  adapter({ registerCommand: (name, command) => commands.set(name, command), on: (name, handler) => events.set(name, handler), appendEntry: (customType, data) => entries.push({ type: 'custom', customType, data }), sendMessage() {} });
  const ctx = { cwd: f.root, sessionManager: { getBranch: () => entries }, ui: { notify: (...args) => notifications.push(args) } };
  await commands.get('forgeflow-plan-lanes').handler(f.filename, ctx);
  await commands.get('forgeflow-prepare-lane').handler(`"${f.filename}" writer`, ctx);
  const prepared = entries.at(-1).data;
  assert.equal(prepared.kind, 'prepared');
  const event = { toolName: 'herdr_plan', toolCallId: 'call-1', input: prepared.planArguments };
  const wrong = { ...event, input: { ...event.input, worktreeCwd: f.root } };
  assert.equal((await events.get('tool_call')(wrong, ctx)).block, true);
  assert.equal(await events.get('tool_call')(event, ctx), undefined);
  assert.equal(entries.at(-1).data.kind, 'planning');
  events.get('tool_result')({ ...event, details: { workflow: { id: 'herdr-test', cwd: f.target } } }, ctx);
  assert.equal(entries.at(-1).data.workflowId, 'herdr-test');
  assert.equal((await events.get('tool_call')(event, ctx)).block, true);
});

async function recoveryFixture(t) {
  const f = await fixture(t);
  const prepared = await prepareLane(f);
  const sessionFile = path.join(f.root, 'original-session.jsonl');
  const workflow = { id: 'herdr-recover', objective: prepared.planArguments.objective, cwd: f.target, lanes: structuredClone(prepared.planArguments.lanes), taskBinding: { rootSessionPath: sessionFile, workspaceId: env.HERDR_WORKSPACE_ID, rootPaneId: env.HERDR_PANE_ID }, worktreeBinding: { repoParent: { checkoutPath: f.root, workspaceId: env.HERDR_WORKSPACE_ID } } };
  const dir = path.join(f.root, '.pi/herdr-orchestrator');
  await mkdir(dir, { recursive: true });
  const save = () => writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ workflows: [workflow] }));
  await save();
  return { ...f, workflow, save, sessionFile, workflowId: workflow.id };
}

test('reconciliation restores only a mapping, without inventing preparation or verification', async t => {
  const f = await recoveryFixture(t);
  const mapped = await reconcileLane(f);
  assert.equal(mapped.workflowId, f.workflowId);
  assert.equal(mapped.kind, 'planned');
  assert.equal(mapped.mappingSource, 'durable-manifest');
  assert.equal('targetHead' in mapped, false);
  assert.equal('verifiedAt' in mapped, false);
  assert.equal('commit' in mapped, false);
});

test('reconciliation rejects foreign roots and mismatched lane evidence', async t => {
  const f = await recoveryFixture(t);
  await assert.rejects(reconcileLane({ ...f, sessionFile: 'another-session' }), /another root/);
  await assert.rejects(reconcileLane({ ...f, env: { ...env, HERDR_WORKSPACE_ID: 'another' } }), /another root/);
  await assert.rejects(reconcileLane({ ...f, workflowId: 'herdr-missing' }), /exactly one/);
  const original = structuredClone(f.workflow);
  for (const change of [w => { w.objective = 'different'; }, w => { w.lanes[0].objective += '\nwrite elsewhere'; }, w => { w.lanes[0].readOnly = true; }, w => { w.lanes[0].launchProfile = { model: 'other' }; }, w => { w.worktreeBinding.repoParent.checkoutPath = f.target; }]) {
    Object.assign(f.workflow, structuredClone(original));
    change(f.workflow);
    await f.save();
    await assert.rejects(reconcileLane(f), /does not match|no matching/);
  }
});

test('reconcile command persists idempotently and rejects conflicting mappings', async t => {
  const f = await recoveryFixture(t);
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const commands = new Map(), entries = [], notifications = [];
  adapter({ registerCommand: (name, command) => commands.set(name, command), appendEntry: (customType, data) => entries.push({ type: 'custom', customType, data }) });
  const ctx = { cwd: f.root, sessionManager: { getBranch: () => entries, getSessionFile: () => f.sessionFile }, ui: { notify: (...args) => notifications.push(args) } };
  const command = commands.get('forgeflow-reconcile-lane');
  const args = `"${f.filename}" writer ${f.workflowId}`;
  await command.handler(args, ctx);
  await command.handler(args, ctx);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].data.workflowId, f.workflowId);
  entries[0].data.workflowId = 'herdr-conflicting';
  await command.handler(args, ctx);
  assert.match(notifications.at(-1)[0], /Conflicting/);
  assert.equal(entries.length, 1);
});

test('native tools save reconciliation and verification through the live extension API', async t => {
  const f = await recoveryFixture(t);
  f.workflow.lanes[0].completionReceipt = { id: 'receipt', summary: 'Completed and checked', delivery: 'delivered' };
  await f.save();
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const tools = new Map(), entries = [];
  adapter({ registerCommand() {}, registerTool: tool => tools.set(tool.name, tool), appendEntry: (customType, data) => entries.push({ type: 'custom', customType, data }) });
  const ctx = { cwd: f.root, sessionManager: { getBranch: () => entries, getSessionFile: () => f.sessionFile } };
  const reconcile = tools.get('forgeflow_reconcile_lane');
  const verify = tools.get('forgeflow_verify_lane');
  const check = { workflowId: f.workflowId, commit: git(f.target, 'rev-parse', 'HEAD'), evidence: 'Independently checked text: pass' };
  await assert.rejects(verify.execute('before', check, undefined, undefined, ctx), /not mapped/);
  const mapped = await reconcile.execute('reconcile', { filename: f.filename, taskId: f.taskId, workflowId: f.workflowId }, undefined, undefined, ctx);
  assert.equal(mapped.details.kind, 'planned');
  assert.equal(entries.length, 1);
  const verified = await verify.execute('verify', check, undefined, undefined, ctx);
  assert.equal(verified.details.kind, 'verified');
  assert.equal(entries.length, 2);
  assert.equal(entries[1].data.commit, check.commit);
  assert.match(verified.content[0].text, /Saved verified record/);
});

test('native preview and prepare persist across reload, share command behavior, and reject stale input', async t => {
  const f = await fixture(t);
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const tools = new Map(), commands = new Map(), entries = [], messages = [], errors = [];
  const api = {
    registerCommand: (name, command) => commands.set(name, command),
    registerTool: tool => tools.set(tool.name, tool),
    appendEntry: (customType, data) => entries.push({ type: 'custom', customType, data }),
    sendMessage: (msg, options) => messages.push({ msg, options }),
  };
  const ctx = { cwd: f.root, sessionManager: { getBranch: () => entries }, ui: { notify: (...args) => errors.push(args) } };
  adapter(api);
  const params = { filename: path.relative(f.root, f.filename), taskId: f.taskId };
  const execute = (name, args) => tools.get(name).execute('call', args, undefined, undefined, ctx);
  await assert.rejects(execute('forgeflow_prepare_lane', params), /forgeflow-plan-lanes/);
  assert.equal(entries.length, 0);
  const result = await execute('forgeflow_plan_lanes', { filename: params.filename });
  assert.equal(result.details.mode, 'preview-only');
  assert.match(result.content[0].text, /Preview only/);
  assert.equal(entries.at(-1).data.kind, 'preview');
  adapter(api); // fresh extension instance reads the existing session branch
  const prepared = await execute('forgeflow_prepare_lane', params);
  assert.equal(prepared.details.kind, 'prepared');
  assert.equal(entries.at(-1).data.kind, 'prepared');
  assert.equal(prepared.details.planArguments.worktreeCwd, f.target);
  assert.match(prepared.content[0].text, /Dispatch remains a separate explicit action/);
  assert.equal(messages.length, 0); // native tools return results, without injecting a turn
  await commands.get('forgeflow-prepare-lane').handler(`"${f.filename}" ${f.taskId}`, ctx);
  assert.equal(errors.length, 0);
  assert.deepEqual(messages[0].msg.details, prepared.details);
  assert.equal(messages[0].options.triggerTurn, false);
  const before = entries.length;
  await writeFile(f.filename, (await readFile(f.filename, 'utf8')) + '\n');
  await assert.rejects(execute('forgeflow_prepare_lane', params), /changed/);
  assert.equal(entries.length, before);
  assert.equal(git(f.root, 'status', '--porcelain'), '');
  assert.equal(git(f.target, 'status', '--porcelain'), '');
});

test('two writer lanes require verification, root integration, and an updated dependent checkout', async t => {
  const f = await fixture(t);
  const targetB = path.join(path.dirname(f.root), 'writer-b');
  git(f.root, 'worktree', 'add', '-b', 'writer-b', targetB);
  f.brief.tasks.push({ id: 'writer-b', objective: 'Extend the first change', files: ['source.txt'], checks: ['Inspect both changes'], worktreeCwd: targetB, dependsOn: ['writer'], launchProfile: f.brief.tasks[0].launchProfile });
  await writeFile(f.filename, JSON.stringify(f.brief));
  f.preview = await loadPreview(f.filename);
  const mapped = { ...await prepareLane(f), kind: 'planned', workflowId: 'herdr-first' };
  const prepareB = records => prepareLane({ ...f, taskId: 'writer-b', records });
  await assert.rejects(prepareB([mapped]), /no root verification/);
  await writeFile(path.join(f.target, 'source.txt'), 'first change');
  git(f.target, 'add', 'source.txt'); git(f.target, 'commit', '-m', 'first change');
  const commit = git(f.target, 'rev-parse', 'HEAD');
  const manifestDir = path.join(f.root, '.pi/herdr-orchestrator');
  await mkdir(manifestDir, { recursive: true });
  await writeFile(path.join(manifestDir, 'manifest.json'), JSON.stringify({ workflows: [{ id: mapped.workflowId, cwd: f.target, lanes: [{ completionReceipt: { id: 'first-receipt', summary: 'First change complete', delivery: 'delivered' } }] }] }));
  // Completion alone is insufficient, even with a real durable receipt.
  await assert.rejects(prepareB([mapped]), /no root verification/);
  const verification = { mapped, commit, evidence: 'Independently checked first change', cwd: f.root };
  await assert.rejects(verifyLane(verification), /not integrated/);
  git(f.root, 'merge', '--ff-only', commit);
  const verified = await verifyLane(verification);
  // Root integration and a verified record do not make a stale target usable.
  await assert.rejects(prepareB([mapped, verified]), /not integrated/);
  git(targetB, 'merge', '--ff-only', commit);
  const preparedB = await prepareB([mapped, verified]);
  assert.equal(preparedB.taskId, 'writer-b');
  assert.equal(preparedB.targetHead, commit);
  assert.equal(preparedB.rootHead, commit);
});
