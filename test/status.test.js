import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { loadPreview } from '../planner.js';
import { laneStatus, renderStatus } from '../status.js';
import adapter from '../extension.js';
import { prepareLane } from '../prepare.js';

const env = { HERDR_ENV: '1', HERDR_PANE_ID: 'test:p1', HERDR_WORKSPACE_ID: 'test' };
async function fixture(t) {
  const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lane status ')));
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
  assert.equal(report.nextAction.code, 'verify-completion');
  assert.equal(report.authorization, 'not-assessed');
  assert.equal(report.nativeReadiness, 'not-checked');
  f.records.push({ ...f.mapped, kind: 'verified', commit: 'a'.repeat(40), evidence: 'Tests passed', verifiedAt: '2026-09-17T00:00:00Z' });
  report = await laneStatus(f);
  assert.equal(report.tasks[0].state, 'verified');
  assert.equal(report.tasks[0].verification.commit, 'a'.repeat(40));
  assert.equal(report.tasks[0].nextAction.code, 'none');
  assert.equal(report.nextAction, null);
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
  assert.equal(task.nextAction.code, 'resume-owning-root');
  const owning = await laneStatus({ ...f, records: [] });
  assert.equal(owning.tasks[0].nextAction.code, 'reconcile-workflow');
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
  assert.equal(report.tasks[0].nextAction.code, 'inspect-ledger');
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
  assert.equal(report.tasks[0].nextAction.code, 'inspect-submission');
});

test('native status and slash command save no adapter records or model turns', async t => {
  const f = await fixture(t);
  const tools = new Map(), commands = new Map(), messages = [];
  adapter({
    registerTool: tool => tools.set(tool.name, tool),
    registerCommand: (name, command) => commands.set(name, command),
    appendEntry() { assert.fail('status must not append adapter records'); },
    exec() { assert.fail('status must not call Herdr or create resources'); },
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

test('all durable receipts lead to verification even with pending notifications or stale blocked telemetry', async t => {
  const f = await fixture(t);
  for (const delivery of ['pending', 'sending', 'delivered', 'uncertain']) {
    f.workflow.status = 'blocked';
    f.workflow.retry = { state: 'retryable', failedStage: 'agent-start', error: 'old failure' };
    f.workflow.lanes[0].completionReceipt.delivery = delivery;
    await f.save();
    const before = await readFile(f.manifest);
    const report = await laneStatus(f);
    assert.equal(report.tasks[0].nextAction.code, 'verify-completion');
    assert.deepEqual(report.tasks[0].receiptDelivery, { [delivery]: 1 });
    assert.match(renderStatus(report), /Do not wait for another notification or redispatch/);
    assert.deepEqual(await readFile(f.manifest), before);
  }
  f.workflow.lanes[0].completionReceipt.summary = '  ';
  await f.save();
  const invalid = await laneStatus(f);
  assert.equal(invalid.tasks[0].completionReceipts, 0);
  assert.equal(invalid.tasks[0].nextAction.code, 'inspect-workflow');
});

test('planned, active, retryable, paused and incomplete terminal workflows never imply automatic dispatch', async t => {
  const f = await fixture(t);
  delete f.workflow.lanes[0].completionReceipt;
  for (const [status, code] of [
    ['planned', 'review-dispatch'], ['starting', 'observe-workflow'], ['running', 'observe-workflow'],
    ['completed', 'inspect-workflow'], ['unknown', 'inspect-workflow'], ['blocked', 'inspect-workflow'],
    ['paused', 'inspect-workflow'], ['closed', 'inspect-workflow'], ['dispatch-failed', 'inspect-workflow'],
  ]) {
    f.workflow.status = status; await f.save();
    const report = await laneStatus(f);
    assert.equal(report.tasks[0].nextAction.code, code, status);
    assert.equal(report.authorization, 'not-assessed');
  }
  f.workflow.status = 'starting';
  f.workflow.retry = { state: 'dispatching' }; await f.save();
  assert.equal((await laneStatus(f)).nextAction.code, 'observe-workflow');
  f.workflow.retry = { state: 'retryable', failedStage: 'agent-start', error: 'folder approval needed' }; await f.save();
  assert.match((await laneStatus(f)).nextAction.reason, /folder approval needed/);
  delete f.workflow.retry;
  f.workflow.status = 'planned'; f.workflow.lanes[0].paneId = 'existing-pane'; await f.save();
  assert.equal((await laneStatus(f)).nextAction.code, 'inspect-workflow');
});

test('only recorded requests produce awaiting-approval or awaiting-answer advice', async t => {
  const f = await fixture(t);
  delete f.workflow.lanes[0].completionReceipt;
  f.workflow.status = 'planned';
  f.workflow.approvalRequests = [{ id: 'approval-1', action: 'dispatch', status: 'parent-approval-required', request: 'Dispatch this planned lane?' }];
  await f.save();
  let report = await laneStatus(f);
  assert.equal(report.nextAction.category, 'awaiting-approval');
  assert.match(renderStatus(report), /Approval approval-1 \(dispatch\)/);
  f.workflow.approvalRequests[0].status = 'approved'; await f.save();
  report = await laneStatus(f);
  assert.equal(report.nextAction.code, 'review-dispatch');
  assert.match(report.nextAction.reason, /existing user authorization/);
  f.workflow.questionRequests = [{ id: 'question-1', status: 'parent-question-required', question: 'Which behavior is intended?' }];
  await f.save();
  report = await laneStatus(f);
  assert.equal(report.nextAction.category, 'awaiting-answer');
  assert.match(renderStatus(report), /Which behavior is intended/);
  f.workflow.questionRequests[0].status = 'answer-delivery-pending'; await f.save();
  assert.equal((await laneStatus(f)).nextAction.code, 'inspect-answer-delivery');
});

test('mapped scope drift, incomplete ownership and vanished receipts override saved success', async t => {
  const f = await fixture(t);
  f.workflow.lanes[0].objective = 'Different scope'; await f.save();
  assert.equal((await laneStatus(f)).nextAction.code, 'inspect-ledger');
  f.workflow.lanes[0].objective = (await loadPreview(f.filename)).workflows[0].planArguments.lanes[0].objective;
  delete f.workflow.taskBinding.rootSessionPath; await f.save();
  assert.equal((await laneStatus(f)).nextAction.code, 'inspect-ledger');
  f.workflow.taskBinding.rootSessionPath = f.sessionFile;
  delete f.workflow.lanes[0].completionReceipt; await f.save();
  f.records.push({ ...f.mapped, kind: 'verified', commit: 'a'.repeat(40) });
  const report = await laneStatus(f);
  assert.equal(report.tasks[0].state, 'verified');
  assert.equal(report.nextAction.code, 'inspect-ledger');
});

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function gitFixture(t) {
  const f = await fixture(t);
  git(f.cwd, 'init'); git(f.cwd, 'config', 'user.name', 'Test'); git(f.cwd, 'config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(f.cwd, '.git/info/exclude'), '.pi/\nbrief.json\nsession.jsonl\n');
  await writeFile(path.join(f.cwd, 'README.md'), '# Status trial\n');
  git(f.cwd, 'add', 'README.md'); git(f.cwd, 'commit', '-m', 'Baseline');
  const brief = JSON.parse(await readFile(f.filename, 'utf8'));
  brief.tasks[0].launchProfile = { provider: 'openai-codex', model: 'test-model', thinking: 'medium', auth: 'subscription' };
  const preview = async () => {
    await writeFile(f.filename, JSON.stringify(brief));
    const result = await loadPreview(f.filename, { cwd: f.cwd });
    f.records.push({ kind: 'preview', sourcePath: result.sourcePath, sourceSha256: result.sourceSha256 });
    return result;
  };
  f.records = []; await f.save([]);
  return { ...f, brief, preview };
}

test('next action progresses from preview to prepare to plan and rejects old or changed preparations', async t => {
  const f = await gitFixture(t);
  assert.equal((await laneStatus(f)).nextAction.code, 'preview');
  const preview = await f.preview();
  assert.equal((await laneStatus(f)).nextAction.code, 'prepare');
  const prepared = await prepareLane({ ...f, taskId: 'review', preview });
  f.records.push(prepared);
  assert.equal((await laneStatus(f)).nextAction.code, 'prepare', 'old preparation lacks native evidence');
  f.records.push({ ...prepared, sessionFile: f.sessionFile, nativeReadiness: { version: 1, root: {
    checkout: f.cwd, sessionFile: f.sessionFile, paneId: env.HERDR_PANE_ID, workspaceId: env.HERDR_WORKSPACE_ID,
  }, source: null } });
  let report = await laneStatus(f);
  assert.equal(report.nextAction.code, 'plan');
  assert.equal(report.tasks[0].savedPreparationCurrent, true);
  const before = JSON.stringify(f.records);
  await writeFile(path.join(f.cwd, 'README.md'), '# Changed\n');
  report = await laneStatus(f);
  assert.equal(report.nextAction.code, 'resolve-prerequisite');
  assert.match(report.nextAction.reason, /dirty/);
  git(f.cwd, 'add', 'README.md'); git(f.cwd, 'commit', '-m', 'New HEAD');
  report = await laneStatus(f);
  assert.equal(report.nextAction.code, 'prepare');
  assert.equal(report.tasks[0].savedPreparationCurrent, false);
  assert.equal(JSON.stringify(f.records), before);
  assert.equal(git(f.cwd, 'status', '--porcelain'), '');
});

test('unresolved launch profiles and missing writer worktrees get concrete advice', async t => {
  const f = await gitFixture(t);
  delete f.brief.tasks[0].launchProfile;
  await f.preview();
  assert.equal((await laneStatus(f)).nextAction.code, 'configure-profile');
  f.brief.tasks[0].readOnly = false;
  await f.preview();
  assert.equal((await laneStatus(f)).nextAction.code, 'assign-worktree');
});

test('dependency receipt alone blocks the next task; verified integrated evidence releases preparation', async t => {
  const f = await gitFixture(t);
  f.brief.tasks.push({ ...f.brief.tasks[0], id: 'followup', objective: 'Review dependent result', dependsOn: ['review'] });
  const preview = await f.preview();
  const mapped = { ...f.mapped, sourceSha256: preview.sourceSha256 };
  f.records.push(mapped);
  f.workflow.lanes = preview.workflows[0].planArguments.lanes.map(lane => ({ ...lane, completionReceipt: { id: 'receipt', summary: 'Done', delivery: 'pending' } }));
  await f.save();
  let report = await laneStatus(f);
  assert.equal(report.nextAction.taskId, 'review');
  assert.equal(report.nextAction.code, 'verify-completion');
  assert.equal(report.tasks[1].nextAction.code, 'wait-dependencies');
  f.records.push({ ...mapped, kind: 'verified', commit: git(f.cwd, 'rev-parse', 'HEAD'), evidence: 'Reviewed', verifiedAt: '2026-09-18T00:00:00Z' });
  report = await laneStatus(f);
  assert.equal(report.tasks[1].nextAction.code, 'prepare');
  assert.equal(report.nextAction.taskId, 'followup');
});

test('earlier snapshot submissions are investigated, not silently replaced', async t => {
  const f = await gitFixture(t);
  const preview = await f.preview();
  f.records.push({ ...f.mapped, sourceSha256: preview.sourceSha256, kind: 'planning', toolCallId: 'unresolved' });
  f.brief.objective = 'Changed brief'; await f.preview();
  assert.equal((await laneStatus(f)).nextAction.code, 'inspect-history');
});
