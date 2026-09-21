import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { diagnoseLane, inspectDiagnosis } from '../workflow-diagnosis-inspection.js';
import { renderDiagnosis, collectDiagnosis } from '../workflow-diagnosis.js';
import { selectDispatchAudit } from '../dispatch-audit.js';
import { startupRetryFixture, git } from './fixtures/startup-retry.js';
import { registerDiagnosis } from '../workflow-diagnosis-command.js';

async function fixture(t) {
  const f = await startupRetryFixture(t);
  f.flow.worktreeBinding.repoParent.repoKey = f.native.responses.worktree.source.repo_key;
  await f.save();
  f.options.taskId = 'writer';
  f.native.calls.length = 0;
  return f;
}

test('selected saved diagnosis ignores a newer unrelated probe and changes no state', async t => {
  const f = await fixture(t);
  f.options.records.push({ ...f.options.previous, intentId: 'probe', workflowId: 'other' });
  const before = await readFile(f.manifestPath), records = structuredClone(f.options.records);
  const result = await diagnoseLane(f.options);
  assert.equal(result.diagnosis, 'startup-before-assignment');
  assert.equal(result.workflowId, 'herdr-one');
  assert.equal(result.recovery.state, 'candidate-only');
  assert.equal(result.recovery.command, null);
  assert.equal(f.native.calls.length, 0);
  assert.equal(result.facts.find(f => f.name === 'dispatch-audit').value.length, 1);
  assert.deepEqual(await readFile(f.manifestPath), before);
  assert.deepEqual(f.options.records, records);
  assert.equal(git(f.target, 'status', '--porcelain'), '');
  const rendered = renderDiagnosis(result);
  assert.match(rendered, /not permission to retry/);
  assert.doesNotMatch(rendered, /workflowId.*other/);
});

test('assignment markers and unknown results block replay despite absent receipt', async t => {
  const f = await fixture(t);
  for (const field of ['promptAttemptedAt', 'promptedAt']) {
    f.flow.lanes[0][field] = 'time'; await f.save();
    const result = await diagnoseLane(f.options);
    assert.equal(result.diagnosis, 'assignment-unresolved');
    assert.equal(result.recovery.command, null);
    assert.match(result.nextStep.reason, /does not prove non-delivery/);
    delete f.flow.lanes[0][field];
  }
  await f.save(); f.options.records.at(-1).outcome = 'unknown';
  assert.equal((await diagnoseLane(f.options)).diagnosis, 'assignment-unresolved');
});

test('stored receipt precedes stale telemetry and delivery, verification stays historical', async t => {
  const f = await fixture(t);
  f.flow.lanes[0].status = 'gone'; f.flow.lanes[0].promptedAt = 'time';
  f.flow.lanes[0].completionReceipt = { id: 'receipt', summary: 'PASS', delivery: 'pending' }; await f.save();
  let result = await diagnoseLane(f.options);
  assert.equal(result.diagnosis, 'completion-awaiting-verification');
  assert.equal(result.nextStep.tool, 'forgeflow_verification_guidance');
  f.options.records.push({ ...f.options.records.find(r => r.kind === 'planned'), kind: 'verified', commit: 'a'.repeat(40), verifiedAt: 'yesterday' });
  result = await diagnoseLane(f.options);
  assert.equal(result.diagnosis, 'verified-historical');
  assert.match(result.nextStep.reason, /no checks were rerun/);
});

test('foreign owners, conflicting mapping, missing records and malformed ledgers never probe', async t => {
  const f = await fixture(t);
  const exec = () => assert.fail('must not probe blocked ownership');
  let r = await diagnoseLane({ ...f.options, inspectNative: true, sessionFile: '/foreign', exec });
  assert.equal(r.diagnosis, 'ownership-or-evidence-blocked');
  r = await diagnoseLane({ ...f.options, records: [], inspectNative: true, exec });
  assert.equal(r.diagnosis, 'ownership-or-evidence-blocked');
  f.options.records.push({ ...f.options.records.find(r => r.kind === 'planned'), workflowId: 'other' });
  r = await diagnoseLane({ ...f.options, inspectNative: true, exec });
  assert.equal(r.diagnosis, 'ownership-or-evidence-blocked');
  await writeFile(f.manifestPath, '{}');
  r = await diagnoseLane({ ...f.options, inspectNative: true, exec });
  assert.equal(r.diagnosis, 'ownership-or-evidence-blocked');
});

test('audit selects all linked attempts for one workflow and rejects conflicts', () => {
  const a = { kind: 'dispatch-intent', workflowId: 'one', intentId: 'a', taskId: 'writer' };
  const b = { ...a, intentId: 'b', retryOf: 'a' };
  const records = [a, b, { ...a, workflowId: 'other', intentId: 'c' }];
  assert.deepEqual(selectDispatchAudit(records, 'one').attempts.map(a => a.intent.intentId), ['a', 'b']);
  assert.equal(selectDispatchAudit(records).workflowId, 'other');
  assert.equal(selectDispatchAudit(records, 'missing').attempts.length, 0);
  assert.ok(selectDispatchAudit([...records, a], 'one').conflicts.length);
  assert.ok(selectDispatchAudit([...records, { kind: 'dispatch-attempt', workflowId: 'one', intentId: 'orphan' }], 'one').conflicts.length);
});

test('live eligibility reuses original startup checker without executing or changing evidence', async t => {
  const f = await fixture(t), before = await readFile(f.manifestPath), history = structuredClone(f.options.records);
  const report = await diagnoseLane({ ...f.options, inspectNative: true });
  assert.equal(report.nativeReadiness, 'inspected', JSON.stringify(report.blockers));
  assert.equal(report.recovery.state, 'eligible-at-inspection');
  assert.equal(report.recovery.command, `/forgeflow-retry-startup "${f.options.filename}"`);
  assert.deepEqual(await readFile(f.manifestPath), before);
  assert.deepEqual(f.options.records, history);
  assert.equal(git(f.target, 'status', '--porcelain'), '');
  assert.equal(report.executed, false);
  await writeFile(f.startup + '.ready', JSON.stringify({ ...f.ready, nonce: 'foreign' }));
  const changed = await diagnoseLane({ ...f.options, inspectNative: true });
  assert.equal(changed.recovery.command, null);
  assert.match(changed.blockers.join(' '), /attestation/);
});

test('newer unrelated dispatch prevents offering a command that would target it', async t => {
  const f = await fixture(t);
  f.options.records.push({ ...f.options.previous, workflowId: 'other', intentId: 'newer' });
  const report = await diagnoseLane({ ...f.options, inspectNative: true });
  assert.equal(report.recovery.command, null);
  assert.match(report.blockers.join(' '), /newer dispatch intent/);
});

test('missing agent is distinguished from an existing foreground shell', async t => {
  const f = await fixture(t); f.flow.lanes[0].promptAttemptedAt = 'time'; await f.save();
  const exec = async (bin, args, opts) => {
    if (args[0] === 'agent' && args[2] === 'child') return { code: 1, stdout: '', stderr: JSON.stringify({ error: { code: 'agent_not_found' } }) };
    if (args[0] === 'pane') return { code: 0, stdout: JSON.stringify({ result: args[1] === 'get'
      ? { pane: { pane_id: 'child', workspace_id: 'w1' } }
      : { process_info: { shell_pid: 123, foreground_processes: [{ pid: 123 }] } } }) };
    return f.options.exec(bin, args, opts);
  };
  const result = await diagnoseLane({ ...f.options, inspectNative: true, exec });
  assert.equal(result.nativeReadiness, 'inspected', result.blockers.join(' '));
  assert.equal(result.diagnosis, 'assignment-unresolved');
  assert.equal(result.facts.find(f => f.name === 'live-agent').state, 'absent-in-inspected-source');
  assert.equal(result.facts.find(f => f.name === 'live-pane').state, 'present');
  assert.equal(result.facts.find(f => f.name === 'foreground-shell').value.soleForegroundShell, true);
  assert.equal(result.recovery.command, null);
});

test('source drift is reported without recreating it; completed receipts remain usable', async t => {
  const f = await fixture(t); f.flow.retry = undefined; f.options.records = f.options.records.filter(r => !r.kind.startsWith('dispatch-')); await f.save();
  delete f.native.responses.worktree.source.source_workspace_id;
  const report = await diagnoseLane({ ...f.options, inspectNative: true });
  assert.equal(report.diagnosis, 'source-binding-changed');
  assert.equal(report.facts.find(f => f.name === 'live-source-binding').value.observed, null);
  f.flow.lanes[0].completionReceipt = { id: 'receipt', summary: 'PASS' }; await f.save();
  assert.equal((await diagnoseLane({ ...f.options, inspectNative: true })).diagnosis, 'completion-awaiting-verification');
});

test('cancellation, malformed native output and changing ledger fail closed', async t => {
  const f = await fixture(t);
  const signal = AbortSignal.abort();
  const cancelled = await diagnoseLane({ ...f.options, inspectNative: true, signal, exec: () => assert.fail('cancelled') });
  assert.equal(cancelled.nativeReadiness, 'incomplete'); assert.equal(cancelled.recovery.command, null);
  const malformed = await diagnoseLane({ ...f.options, inspectNative: true, exec: async () => ({ code: 0, stdout: 'not-json' }) });
  assert.equal(malformed.recovery.command, null); assert.equal(malformed.nativeReadiness, 'incomplete');
  const exec = async (...args) => { const r = await f.options.exec(...args); await writeFile(f.manifestPath, (await readFile(f.manifestPath, 'utf8')) + '\n'); return r; };
  const drift = await diagnoseLane({ ...f.options, inspectNative: true, exec });
  assert.equal(drift.recovery.command, null); assert.equal(drift.nativeReadiness, 'incomplete');
});

test('registered diagnosis defaults to local inspection and refuses execute or multiline input', async t => {
  const f = await fixture(t), commands = new Map(), tools = new Map(), messages = [], notices = [];
  const pi = { registerTool: tool => tools.set(tool.name, tool), registerCommand: (name, cmd) => commands.set(name, cmd),
    exec: () => assert.fail('no native call by default'), appendEntry: () => assert.fail('no records'),
    sendMessage: (message, options) => messages.push({ message, options }) };
  registerDiagnosis(pi, () => f.options.records);
  const ctx = { cwd: f.options.cwd, sessionManager: { getSessionFile: () => f.options.sessionFile }, ui: { notify: text => notices.push(text) } };
  // Without actual Herdr env, local reports explain the ownership gap without native calls.
  const tool = tools.get('forgeflow_diagnose_lane');
  const report = await tool.execute('one', { filename: f.options.filename, taskId: 'writer' }, undefined, undefined, ctx);
  assert.equal(report.details.executed, false);
  await assert.rejects(tool.execute('bad', { filename: f.options.filename, taskId: 'writer', execute: true }, undefined, undefined, ctx), /read-only/);
  await commands.get('forgeflow-diagnose-lane').handler(`"${f.options.filename}" writer`, ctx);
  assert.equal(messages[0].options.triggerTurn, false);
  await commands.get('forgeflow-diagnose-lane').handler(`"${f.options.filename}" writer\n--live`, ctx);
  assert.match(notices[0], /one line/);
});

test('overall deadline bounds an unresponsive transport without eligibility', async t => {
  const f = await fixture(t);
  const snapshot = await collectDiagnosis(f.options);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = inspectDiagnosis({ ...f.options, exec: () => new Promise(() => {}) }, snapshot);
  t.mock.timers.tick(15000);
  const report = await pending;
  assert.equal(report.nativeReadiness, 'incomplete');
  assert.equal(report.recovery.command, null);
  assert.match(report.blockers.join(' '), /timed out/);
  t.mock.timers.reset();
});

test('oversized native output and newly appended session evidence suppress eligibility', async t => {
  const f = await fixture(t);
  const huge = await diagnoseLane({ ...f.options, inspectNative: true,
    exec: async () => ({ code: 0, stdout: 'x'.repeat(256 * 1024 + 1) }) });
  assert.equal(huge.nativeReadiness, 'incomplete');
  assert.equal(huge.recovery.command, null);
  const changed = await diagnoseLane({ ...f.options, inspectNative: true,
    getRecords: () => [...f.options.records, { kind: 'dispatch-intent', intentId: 'new' }] });
  assert.equal(changed.recovery.command, null);
  assert.match(changed.blockers.join(' '), /Session evidence changed/);
});
