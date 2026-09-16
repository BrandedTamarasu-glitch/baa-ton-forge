import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadPreview } from '../planner.js';
import { prepareLane, revalidate, verifyLane } from '../prepare.js';
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
  const task = { id: 'writer', objective: 'Change text', files: ['source.txt'], checks: ['Inspect text'], worktreeCwd: target };
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

test('dependencies require matching verification and commit ancestry in target', async t => {
  const f = await fixture(t);
  f.brief.tasks.push({ id: 'review', objective: 'Review text', readOnly: true, files: ['source.txt'], checks: ['Inspect diff'] });
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
