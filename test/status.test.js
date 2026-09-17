import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadPreview } from '../planner.js';
import { laneStatus, renderStatus } from '../status.js';
import adapter from '../extension.js';

const env = { HERDR_ENV: '1', HERDR_PANE_ID: 'test:p1', HERDR_WORKSPACE_ID: 'test' };
async function fixture(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'lane status '));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const filename = path.join(cwd, 'brief.json');
  await writeFile(filename, JSON.stringify({ version: 1, objective: 'Review trial', acceptance: ['Correct'], tasks: [{ id: 'review', objective: 'Inspect change', readOnly: true, files: ['src/'], checks: ['Inspect diff'] }] }));
  const preview = await loadPreview(filename);
  const sessionFile = path.join(cwd, 'session.jsonl');
  const args = preview.workflows[0].planArguments;
  const workflow = { id: 'herdr-status', cwd, objective: args.objective, lanes: structuredClone(args.lanes), taskBinding: { rootSessionPath: sessionFile, rootPaneId: env.HERDR_PANE_ID, workspaceId: env.HERDR_WORKSPACE_ID }, status: 'completed' };
  workflow.lanes[0].completionReceipt = { id: 'receipt', summary: 'Done' };
  const manifest = path.join(cwd, '.pi/herdr-orchestrator/manifest.json');
  await mkdir(path.dirname(manifest), { recursive: true });
  const save = (workflows = [workflow]) => writeFile(manifest, JSON.stringify({ workflows }));
  await save();
  const mapped = { kind: 'planned', taskId: 'review', workflowId: workflow.id, root: cwd, sourcePath: preview.sourcePath, sourceSha256: preview.sourceSha256, paneId: env.HERDR_PANE_ID, workspaceId: env.HERDR_WORKSPACE_ID };
  return { cwd, filename, sessionFile, env, records: [mapped], mapped, workflow, manifest, save };
}

test('status distinguishes receipts from historical root verification without changing files', async t => {
  const f = await fixture(t);
  const before = await readFile(f.manifest, 'utf8');
  let report = await laneStatus(f);
  assert.equal(report.tasks[0].state, 'completed-unverified');
  assert.equal(report.tasks[0].verification, null);
  assert.equal(report.tasks[0].completionReceipts, 1);
  assert.deepEqual(report.tasks[0].blockers, []);
  f.records.push({ ...f.mapped, kind: 'verified', commit: 'a'.repeat(40), evidence: 'Tests passed', verifiedAt: '2026-09-17T00:00:00Z' });
  report = await laneStatus(f);
  assert.equal(report.tasks[0].state, 'verified');
  assert.equal(report.tasks[0].verification.commit, 'a'.repeat(40));
  assert.match(renderStatus(report), /historical evidence; tests were not rerun/);
  assert.equal(await readFile(f.manifest, 'utf8'), before);
});

test('fresh session finds durable owner and requests reconciliation, not redispatch', async t => {
  const f = await fixture(t);
  const report = await laneStatus({ ...f, records: [], sessionFile: 'different-session' });
  const task = report.tasks[0];
  assert.equal(task.state, 'unmapped-workflow');
  assert.equal(task.workflowId, f.workflow.id);
  assert.equal(task.owner.sessionFile, f.sessionFile);
  assert.equal(task.prepareCheck, 'not-run');
  assert.match(task.blockers.join('\n'), /owning Herdr root/);
  assert.match(task.blockers.join('\n'), /reconcile/);
  assert.match(report.warnings.join('\n'), /does not mean the task has never run/);
});

test('stale verification is ignored and ambiguous workflows are never selected', async t => {
  const f = await fixture(t);
  f.records.push({ ...f.mapped, kind: 'verified', commit: 'a'.repeat(40) });
  await writeFile(f.filename, (await readFile(f.filename, 'utf8')) + '\n');
  await f.save([f.workflow, { ...f.workflow, id: 'herdr-second' }]);
  const report = await laneStatus(f);
  assert.equal(report.staleRecordCount, 2);
  assert.equal(report.tasks[0].verification, null);
  assert.equal(report.tasks[0].workflowId, null);
  assert.equal(report.tasks[0].owner, null);
  assert.match(report.tasks[0].blockers.join('\n'), /Multiple matching/);
});

test('missing or malformed manifest reports uncertainty without losing historical records', async t => {
  const f = await fixture(t);
  for (const value of [null, { workflows: [null] }, { workflows: [{ id: 'bad', lanes: [null] }] }]) {
    await writeFile(f.manifest, JSON.stringify(value));
    const report = await laneStatus(f);
    assert.equal(report.manifestReadable, false);
    assert.match(report.warnings.join('\n'), /Cannot read/);
    assert.match(report.tasks[0].blockers.join('\n'), /missing or ambiguous/);
  }
  await rm(f.manifest);
  const report = await laneStatus({ ...f, records: [], env: {} });
  assert.equal(report.tasks[0].state, 'untracked');
  assert.equal(report.tasks[0].prepareCheck, 'blocked');
  assert.match(report.warnings.join('\n'), /wrong project root/);
  assert.match(report.tasks[0].blockers.join('\n'), /real Herdr pane/);
});

test('unfinished submission stays blocked; unrelated workflow is not adopted', async t => {
  const f = await fixture(t);
  f.workflow.lanes[0].objective = 'Unrelated task';
  await f.save();
  const report = await laneStatus({ ...f, records: [{ ...f.mapped, kind: 'planning', workflowId: undefined }] });
  assert.equal(report.tasks[0].state, 'submitted-unmapped');
  assert.equal(report.tasks[0].workflowId, null);
  assert.equal(report.tasks[0].prepareCheck, 'not-run');
  assert.match(report.tasks[0].blockers.join('\n'), /ledger before retrying/);
});

test('native status and slash command save no adapter records or model turns', async t => {
  const f = await fixture(t);
  const tools = new Map(), commands = new Map(), messages = [];
  adapter({
    registerTool: tool => tools.set(tool.name, tool),
    registerCommand: (name, command) => commands.set(name, command),
    appendEntry() { assert.fail('status must not append adapter records'); },
    sendMessage: (message, options) => messages.push({ message, options }),
  });
  const ctx = { cwd: f.cwd, sessionManager: { getSessionFile: () => f.sessionFile, getBranch: () => f.records.map(data => ({ type: 'custom', customType: 'forgeflow-adapter', data })) }, ui: { notify: message => assert.fail(message) } };
  const result = await tools.get('forgeflow_status').execute('status', { filename: 'brief.json' }, undefined, undefined, ctx);
  assert.equal(result.details.mode, 'read-only-status');
  assert.equal(messages.length, 0);
  await commands.get('forgeflow-status').handler('"brief.json"', ctx);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].options.triggerTurn, false);
  assert.deepEqual(messages[0].message.details, result.details);
});
