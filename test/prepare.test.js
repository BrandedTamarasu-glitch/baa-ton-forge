import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadPreview } from '../planner.js';
import { prepareLane, revalidate, verifyLane, reconcileLane } from '../prepare.js';
import adapter from '../extension.js';
import { recoverSubmission, submissionRecovered } from '../recovery.js';
import { laneStatus } from '../status.js';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeFixture } from './native-fixture.js';
import { nativePreflight } from '../preflight.js';
import { readManifestSnapshot } from '../manifest-snapshot.js';

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

const recoveryCases = [
  ['root', 'Only the verified controller-mapped root may create or update the parent goal or queue.', 'pre-persistence-root-rejection'],
  ['source-workspace', 'Herdr worktree list response is missing source_workspace_id.', 'pre-persistence-source-workspace-rejection'],
];

async function rejectedSubmission(t, rejection = recoveryCases[0][1], matchingWorkflow = false) {
  const f = await fixture(t);
  const prepared = await prepareLane(f);
  const manifestPath = path.join(f.root, '.pi/herdr-orchestrator/manifest.json');
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify({ version: 2, workflows: matchingWorkflow ? [{ id: 'existing', objective: prepared.planArguments.objective }] : [], parentGoal: { objective: 'unrelated history' } }));
  await delay(10);
  const timestamp = new Date().toISOString(), toolCallId = 'native-plan-1';
  const entries = [
    { id: 'assistant', timestamp, type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: toolCallId, name: 'herdr_plan', arguments: prepared.planArguments }] } },
    { id: 'planning', timestamp, type: 'custom', customType: 'forgeflow-adapter', data: { ...prepared, kind: 'planning', toolCallId } },
    { id: 'result', timestamp, type: 'message', message: { role: 'toolResult', toolName: 'herdr_plan', toolCallId, isError: true, content: [{ type: 'text', text: rejection }] } },
  ];
  return { ...f, entries, sessionFile: '/fixture/session.jsonl', prepared, manifestPath };
}

test('native preflight rejects missing roots, foreign sessions and absent or ambiguous source workspaces', async t => {
  const f = await fixture(t), prepared = await prepareLane(f), native = await nativeFixture(f, env);
  const options = { prepared, sessionFile: native.sessionFile, exec: native.exec, env: native.env };
  const passed = await nativePreflight(options);
  assert.equal(passed.root.sessionFile, native.sessionFile);
  assert.equal(passed.source.workspaceId, 'source-workspace');
  assert.deepEqual(native.calls.map(call => call.args.slice(0, 2)), [['agent', 'get'], ['worktree', 'list'], ['workspace', 'list']]);
  const baseline = structuredClone(native.responses);
  for (const [change, error] of [
    [value => { value.agent.agent.agent_session.value = '/different-session'; }, /Live root session/],
    [value => { value.agent.agent.pane_id = 'wrong'; }, /Live agent differs/],
    [value => { delete value.worktree.source.source_workspace_id; }, /missing source_workspace_id/],
    [value => { value.workspace.workspaces = []; }, /source workspace no longer exists/],
    [value => { value.workspace.workspaces.push(value.workspace.workspaces[0]); }, /source workspace no longer exists/],
    [value => { value.worktree.worktrees.push(value.worktree.worktrees[0]); }, /exactly once/],
    [value => { value.worktree.worktrees[0].open_workspace_id = 'occupied'; }, /already has an open/],
    [value => { value.workspace.workspaces[0].worktree = { repo_key: 'foreign', checkout_path: f.root }; }, /metadata disagrees/],
  ]) {
    Object.assign(native.responses, structuredClone(baseline)); change(native.responses);
    await assert.rejects(nativePreflight(options), error);
  }
  Object.assign(native.responses, baseline);
  await assert.rejects(nativePreflight({ ...options, exec: undefined }), /inspection is unavailable/);
  await assert.rejects(nativePreflight({ ...options, exec: async () => ({ code: 1, stdout: '' }) }), /failed; inspect/);
  await assert.rejects(nativePreflight({ ...options, exec: async () => ({ code: 0, stdout: 'not json' }) }), /invalid JSON/);
  await writeFile(native.configPath, JSON.stringify({ ...native.config, orchestrators: [] }));
  await assert.rejects(nativePreflight(options), /registered controller root/);
  await writeFile(native.configPath, JSON.stringify({ ...native.config, orchestrators: [native.config.orchestrators[0], native.config.orchestrators[0]] }));
  await assert.rejects(nativePreflight(options), /unique registered/);
  const foreignConfig = structuredClone(native.config);
  foreignConfig.orchestrators[0].program.parent_manifest_path = path.join(f.target, '.pi/herdr-orchestrator/manifest.json');
  await writeFile(native.configPath, JSON.stringify(foreignConfig));
  await assert.rejects(nativePreflight(options), /another checkout/);
  await writeFile(native.configPath, JSON.stringify(native.config));
  const other = await fixture(t);
  native.responses.worktree.source.source_checkout_path = other.root;
  native.responses.worktree.source.repo_root = other.root;
  await assert.rejects(nativePreflight(options), /does not match the declared repository/);
  native.responses.worktree.source.source_checkout_path = f.root;
  native.responses.worktree.source.repo_root = f.root;
  const readOnlyRoot = { ...prepared, target: f.root, planArguments: { ...prepared.planArguments } };
  delete readOnlyRoot.planArguments.worktreeCwd;
  native.calls.length = 0;
  assert.equal((await nativePreflight({ ...options, prepared: readOnlyRoot })).source, null);
  assert.equal(native.calls.length, 1, 'root-only review does not require an unrelated source workspace');
});

test('saved submission fingerprint tolerates only owning root activity, not durable effects', async t => {
  const f = await rejectedSubmission(t, recoveryCases[1][1]);
  const owner = { paneId: env.HERDR_PANE_ID, workspaceId: env.HERDR_WORKSPACE_ID, sessionFile: f.sessionFile };
  const manifest = { version: 2, workflows: [], parentGoal: { status: 'active', objective: 'Existing goal' }, sessionLog: {
    kind: 'root', paneId: owner.paneId, workspaceId: owner.workspaceId, status: 'active', lastResponseAt: 'before',
    sessionRef: { provider: 'pi', sessionId: f.sessionFile, nativeHandle: { kind: 'path', value: f.sessionFile } },
  } };
  await writeFile(f.manifestPath, JSON.stringify(manifest));
  f.entries[1].data.manifestSnapshot = (await readManifestSnapshot(f.root, owner)).snapshot;
  f.entries[1].data.sessionFile = f.sessionFile;
  await delay(5);
  f.entries[1].timestamp = new Date().toISOString(); f.entries[2].timestamp = f.entries[1].timestamp;
  const activity = structuredClone(manifest); activity.sessionLog.status = 'idle'; activity.sessionLog.lastResponseAt = 'after';
  await writeFile(f.manifestPath, JSON.stringify(activity, null, 2));
  const record = await recoverSubmission(f);
  assert.equal(record.evidence.manifestProof, 'saved-pre-submission-snapshot');
  assert.notEqual(record.evidence.before.rawSha256, record.evidence.after.rawSha256);
  assert.equal(record.evidence.before.stateSha256, record.evidence.after.stateSha256);
  for (const change of [
    value => { value.version = 99; },
    value => { value.owner.sessionFile = '/foreign'; },
    value => { value.capturedAt = new Date(Date.parse(f.entries[1].timestamp) + 10000).toISOString(); },
    value => { value.stateSha256 = 'invalid'; },
  ]) {
    const entries = structuredClone(f.entries); change(entries[1].data.manifestSnapshot);
    await assert.rejects(recoverSubmission({ ...f, entries }), /snapshot/);
  }
  for (const change of [
    value => { value.workflows.push({ id: 'new', objective: 'new workflow' }); },
    value => { value.parentGoal.status = 'paused'; },
    value => { value.sessionLog.sessionRef.sessionId = 'foreign'; },
    value => { value.sessionLog.unknown = 'new state'; },
    value => { value.queue = { items: [] }; },
  ]) {
    const changed = structuredClone(activity); change(changed);
    await writeFile(f.manifestPath, JSON.stringify(changed));
    await assert.rejects(recoverSubmission(f), /differs from the saved/);
  }
  await rm(f.manifestPath);
  await assert.rejects(recoverSubmission(f), /differs from the saved/);
  // A first plan can snapshot genuine manifest absence without inventing a file.
  f.entries[1].data.manifestSnapshot = (await readManifestSnapshot(f.root, owner)).snapshot;
  await delay(5);
  f.entries[1].timestamp = new Date().toISOString(); f.entries[2].timestamp = f.entries[1].timestamp;
  assert.equal((await recoverSubmission(f)).evidence.after.exists, false);
  await writeFile(f.manifestPath, JSON.stringify({ version: 2, workflows: [] }));
  await assert.rejects(recoverSubmission(f), /differs from the saved/);
});

for (const [kind, rejection, reason] of recoveryCases) test(`native ${kind} recovery retains failed history across reload and permits only that attempt to retry`, async t => {
  const f = await rejectedSubmission(t, rejection), original = structuredClone(f.entries);
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const ctx = { cwd: f.root, sessionManager: { getBranch: () => f.entries, getSessionFile: () => f.sessionFile } };
  const reload = () => {
    const tools = new Map();
    adapter({ registerCommand() {}, registerTool: tool => tools.set(tool.name, tool), appendEntry: (customType, data) => f.entries.push({ type: 'custom', customType, data }) });
    return tools.get('forgeflow_recover_submission');
  };
  const before = await readFile(f.manifestPath, 'utf8');
  await assert.rejects(prepareLane({ ...f, records: [f.entries[1].data] }), /already mapped/);
  const result = await reload().execute('recovery', { filename: f.filename, taskId: f.taskId }, undefined, undefined, ctx);
  assert.equal(result.details.kind, 'submission-no-effect');
  assert.equal(result.details.evidence.reason, reason);
  assert.equal(result.details.evidence.resultEntryId, 'result');
  assert.deepEqual(f.entries.slice(0, 3), original);
  assert.equal(await readFile(f.manifestPath, 'utf8'), before);
  await reload().execute('retry', { filename: f.filename, taskId: f.taskId }, undefined, undefined, ctx);
  assert.equal(f.entries.length, 4, 'reload is idempotent');
  const records = f.entries.filter(entry => entry.type === 'custom').map(entry => entry.data);
  assert.equal((await prepareLane({ ...f, records })).targetHead, f.prepared.targetHead);
  const status = await laneStatus({ ...f, records: [{ ...f.preview, kind: 'preview' }, ...records] });
  assert.notEqual(status.tasks[0].state, 'submitted-unmapped');
  assert.equal(status.tasks[0].prepareCheck, 'passed');
  const otherAttempt = { ...f.entries[1].data, toolCallId: 'native-plan-2' };
  assert.equal(submissionRecovered(otherAttempt, records), false);
  await assert.rejects(prepareLane({ ...f, records: [...records, otherAttempt] }), /already mapped/);
  await assert.rejects(prepareLane({ ...f, records: [...records, { ...f.prepared, kind: 'planned', workflowId: 'durable' }] }), /already mapped/);
  let guard;
  adapter({ registerCommand() {}, on: (name, handler) => { if (name === 'tool_call') guard = handler; } });
  const staleHistory = [f.prepared, ...records].map(data => ({ type: 'custom', customType: 'forgeflow-adapter', data }));
  const blocked = await guard({ toolName: 'herdr_plan', toolCallId: 'retry', input: f.prepared.planArguments }, { cwd: f.root, sessionManager: { getBranch: () => staleHistory } });
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /prepare the lane again/);
});

for (const [kind, rejection] of recoveryCases) test(`${kind} recovery rejects ambiguous outcomes, missing native evidence, mismatched arguments and foreign identity`, async t => {
  const f = await rejectedSubmission(t, rejection);
  for (const change of [
    entries => { entries[2].message.isError = false; },
    entries => { entries[2].message.content[0].text = 'Database write failed'; },
    entries => { entries[0].message.content[0].arguments = { objective: 'different' }; },
    entries => { entries.pop(); },
    entries => { entries.push(structuredClone(entries[2])); },
    entries => { entries[1].timestamp = 'bad'; },
  ]) {
    const entries = structuredClone(f.entries); change(entries);
    await assert.rejects(recoverSubmission({ ...f, entries }));
  }
  await assert.rejects(recoverSubmission({ ...f, env: { ...env, HERDR_PANE_ID: 'other' } }), /another pane/);
  await assert.rejects(recoverSubmission({ ...f, env: {} }), /real Herdr/);
  const entries = [...f.entries, { type: 'custom', customType: 'forgeflow-adapter', data: { ...f.prepared, kind: 'planned', workflowId: 'durable' } }];
  await assert.rejects(recoverSubmission({ ...f, entries }), /durable mapping/);
  await delay(5);
  await writeFile(f.manifestPath, JSON.stringify({ version: 2, workflows: [], parentGoal: { objective: 'partial write' } }));
  await assert.rejects(recoverSubmission(f), /Manifest changed since submission/);
});

test('source-workspace recovery rejects nearby errors, missing worktree binding and existing workflows', async t => {
  const f = await rejectedSubmission(t, recoveryCases[1][1]);
  for (const error of [
    'Herdr worktree list response is missing repo_key.',
    'Herdr worktree list response is missing source_workspace_id. Persistence failed.',
    'workspace_not_found',
  ]) {
    const entries = structuredClone(f.entries);
    entries[2].message.content[0].text = error;
    await assert.rejects(recoverSubmission({ ...f, entries }), /exact supported/);
  }
  for (const target of [undefined, 'relative/worktree']) {
    const entries = structuredClone(f.entries);
    entries[0].message.content[0].arguments.worktreeCwd = target;
    entries[1].data.planArguments.worktreeCwd = target;
    await assert.rejects(recoverSubmission({ ...f, entries }), /explicit absolute worktreeCwd/);
  }
  const existing = await rejectedSubmission(t, recoveryCases[1][1], true);
  await assert.rejects(recoverSubmission(existing), /matching durable workflow/);
});

test('newer root activity requires exact prior native workflow evidence, not just no matching plan', async t => {
  const f = await rejectedSubmission(t, recoveryCases[1][1]);
  const workflow = { id: 'old-workflow', objective: 'Completed earlier task', status: 'completed', lanes: [{ id: 'lane-1', completionReceipt: { id: 'receipt', summary: 'done' } }] };
  const timestamp = new Date(Date.parse(f.entries[1].timestamp) - 1000).toISOString();
  const history = [
    { id: 'observe-call', timestamp, type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'observe-id', name: 'herdr_observe', arguments: { workflowId: workflow.id } }] } },
    { id: 'observe-result', timestamp, type: 'message', message: { role: 'toolResult', toolName: 'herdr_observe', toolCallId: 'observe-id', isError: false, details: { workflow: structuredClone(workflow) } } },
  ];
  const manifest = { version: 2, workflows: [workflow], sessionLog: { kind: 'root', paneId: env.HERDR_PANE_ID, workspaceId: env.HERDR_WORKSPACE_ID,
    sessionRef: { provider: 'pi', sessionId: f.sessionFile, nativeHandle: { kind: 'path', value: f.sessionFile } },
    startedAt: timestamp, lastResponseAt: new Date().toISOString(), status: 'active' } };
  await delay(5);
  await writeFile(f.manifestPath, JSON.stringify(manifest));
  const entries = [...history, ...f.entries], original = structuredClone(entries);
  const before = await readFile(f.manifestPath, 'utf8');
  const recovered = await recoverSubmission({ ...f, entries });
  assert.equal(recovered.evidence.manifestProof, 'exact-pre-submission-native-observations');
  assert.equal(recovered.evidence.observations[0].observationEntryId, 'observe-result');
  assert.deepEqual(entries, original);
  assert.equal(await readFile(f.manifestPath, 'utf8'), before);
  for (const change of [
    value => { value.workflows[0].lanes[0].completionReceipt.summary = 'changed'; },
    value => { value.workflows.push({ id: 'new', objective: 'unrelated' }); },
    value => { value.workflows = []; },
    value => { value.parentGoal = { status: 'active' }; },
    value => { value.sessionLog.paneId = 'foreign'; },
    value => { value.sessionLog.newUnprovenField = true; },
  ]) {
    const changed = structuredClone(manifest); change(changed);
    await writeFile(f.manifestPath, JSON.stringify(changed));
    await assert.rejects(recoverSubmission({ ...f, entries }), /Manifest changed since submission/);
  }
  await writeFile(f.manifestPath, JSON.stringify(manifest));
  for (const change of [
    value => { value.shift(); },
    value => { value[0].message.content[0].arguments.workflowId = 'foreign'; },
    value => { value.splice(2, 0, structuredClone(value[1])); },
    value => { value[1].timestamp = f.entries[1].timestamp; },
    value => { value[1].message.isError = true; },
  ]) {
    const changed = structuredClone(entries); change(changed);
    await assert.rejects(recoverSubmission({ ...f, entries: changed }), /Manifest changed since submission/);
  }
});

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

test('named profiles bind preview, preparation and dependency verification to project config', async t => {
  const f = await fixture(t);
  const launchProfile = f.brief.tasks[0].launchProfile;
  delete f.brief.tasks[0].launchProfile;
  f.brief.tasks[0].taskProfile = 'quick';
  f.brief.tasks.push({ id: 'review', objective: 'Review text', taskProfile: 'review', files: ['source.txt'], checks: ['Inspect diff'] });
  await mkdir(path.join(f.root, '.baa-ton'));
  await writeFile(path.join(f.root, '.git/info/exclude'), '.pi/\n.baa-ton/\n');
  const configPath = path.join(f.root, '.baa-ton/config.json');
  const config = { version: 1, profiles: { quick: { agentKind: 'pi', launchProfile }, review: { agentKind: 'pi', launchProfile } } };
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(f.filename, JSON.stringify(f.brief));
  f.preview = await loadPreview(f.filename, { cwd: f.root });
  const tools = new Map(), entries = [];
  adapter({ registerCommand() {}, registerTool: tool => tools.set(tool.name, tool), appendEntry: (_type, data) => entries.push(data) });
  const nativePreview = await tools.get('forgeflow_plan_lanes').execute('preview', { filename: f.filename }, undefined, undefined, { cwd: f.root });
  assert.equal(nativePreview.details.sourceSha256, f.preview.sourceSha256);
  assert.equal(entries[0].sourceSha256, f.preview.sourceSha256);
  const prepared = await prepareLane(f);
  assert.deepEqual(prepared.planArguments.lanes[0].launchProfile, launchProfile);
  await revalidate(prepared, [], env);
  const verified = { ...prepared, kind: 'verified', commit: prepared.targetHead };
  assert.equal((await prepareLane({ ...f, taskId: 'review', records: [verified] })).taskId, 'review');
  config.profiles.quick.launchProfile = { ...launchProfile, model: 'different-model' };
  await writeFile(configPath, JSON.stringify(config));
  await assert.rejects(prepareLane(f), /configuration is new or changed/);
  await assert.rejects(revalidate(prepared, [], env), /configuration is new or changed/);
  const refreshed = await loadPreview(f.filename, { cwd: f.root });
  await assert.rejects(prepareLane({ ...f, preview: refreshed, taskId: 'review', records: [verified] }), /no root verification/);
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
  const native = await nativeFixture(f, env);
  const oldConfigDir = process.env.HERDR_PLUGIN_CONFIG_DIR;
  process.env.HERDR_PLUGIN_CONFIG_DIR = native.env.HERDR_PLUGIN_CONFIG_DIR;
  t.after(() => { if (oldConfigDir === undefined) delete process.env.HERDR_PLUGIN_CONFIG_DIR; else process.env.HERDR_PLUGIN_CONFIG_DIR = oldConfigDir; });
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const commands = new Map(), events = new Map(), entries = [];
  const notifications = [];
  adapter({ exec: native.exec, registerCommand: (name, command) => commands.set(name, command), on: (name, handler) => events.set(name, handler), appendEntry: (customType, data) => entries.push({ type: 'custom', customType, data }), sendMessage() {} });
  const ctx = { cwd: f.root, sessionManager: { getBranch: () => entries, getSessionFile: () => native.sessionFile }, ui: { notify: (...args) => notifications.push(args) } };
  await commands.get('forgeflow-plan-lanes').handler(f.filename, ctx);
  await commands.get('forgeflow-prepare-lane').handler(`"${f.filename}" writer`, ctx);
  const prepared = entries.at(-1).data;
  assert.equal(prepared.kind, 'prepared');
  const event = { toolName: 'herdr_plan', toolCallId: 'call-1', input: prepared.planArguments };
  const wrong = { ...event, input: { ...event.input, worktreeCwd: f.root } };
  assert.equal((await events.get('tool_call')(wrong, ctx)).block, true);
  const entryCount = entries.length;
  delete native.responses.worktree.source.source_workspace_id;
  const missingSource = await events.get('tool_call')(event, ctx);
  assert.equal(missingSource.block, true);
  assert.match(missingSource.reason, /missing source_workspace_id/);
  assert.equal(entries.length, entryCount, 'failed preflight never records a submission');
  native.responses.worktree.source.source_workspace_id = 'replacement-source';
  native.responses.workspace.workspaces[0].workspace_id = 'replacement-source';
  assert.match((await events.get('tool_call')(event, ctx)).reason, /binding changed since prepare/);
  assert.equal(entries.length, entryCount);
  native.responses.worktree.source.source_workspace_id = 'source-workspace';
  native.responses.workspace.workspaces[0].workspace_id = 'source-workspace';
  assert.equal(await events.get('tool_call')(event, ctx), undefined);
  assert.equal(entries.at(-1).data.kind, 'planning');
  assert.equal(entries.at(-1).data.manifestSnapshot.exists, false);
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

test('named-profile recovery requires the configured profile to match the durable lane', async t => {
  const f = await recoveryFixture(t);
  const launchProfile = f.brief.tasks[0].launchProfile;
  delete f.brief.tasks[0].launchProfile;
  f.brief.tasks[0].taskProfile = 'quick';
  await mkdir(path.join(f.root, '.baa-ton'));
  await writeFile(path.join(f.root, '.git/info/exclude'), '.pi/\n.baa-ton/\n');
  const configPath = path.join(f.root, '.baa-ton/config.json');
  const config = { version: 1, profiles: { quick: { agentKind: 'pi', launchProfile } } };
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(f.filename, JSON.stringify(f.brief));
  assert.equal((await reconcileLane(f)).workflowId, f.workflowId);
  config.profiles.quick.launchProfile.model = 'different-model';
  await writeFile(configPath, JSON.stringify(config));
  await assert.rejects(reconcileLane(f), /does not match/);
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
  const native = await nativeFixture(f, env);
  const oldConfigDir = process.env.HERDR_PLUGIN_CONFIG_DIR;
  process.env.HERDR_PLUGIN_CONFIG_DIR = native.env.HERDR_PLUGIN_CONFIG_DIR;
  t.after(() => { if (oldConfigDir === undefined) delete process.env.HERDR_PLUGIN_CONFIG_DIR; else process.env.HERDR_PLUGIN_CONFIG_DIR = oldConfigDir; });
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const tools = new Map(), commands = new Map(), entries = [], messages = [], errors = [];
  const api = {
    exec: native.exec,
    registerCommand: (name, command) => commands.set(name, command),
    registerTool: tool => tools.set(tool.name, tool),
    appendEntry: (customType, data) => entries.push({ type: 'custom', customType, data }),
    sendMessage: (msg, options) => messages.push({ msg, options }),
  };
  const ctx = { cwd: f.root, sessionManager: { getBranch: () => entries, getSessionFile: () => native.sessionFile }, ui: { notify: (...args) => errors.push(args) } };
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
  const previewCount = entries.length;
  native.responses.agent.agent.agent_session.value = '/wrong/session';
  await assert.rejects(execute('forgeflow_prepare_lane', params), /Live root session differs/);
  assert.equal(entries.length, previewCount, 'native prepare failure writes no handoff or submission');
  native.responses.agent.agent.agent_session.value = native.sessionFile;
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
