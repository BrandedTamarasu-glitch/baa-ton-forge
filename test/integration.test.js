import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { startupRetryFixture, git } from './fixtures/startup-retry.js';
import { verificationGuidance } from '../verification-guidance.js';
import { verificationFingerprint, buildVerificationDraft, collectVerificationEvidence, registerVerificationHandoff } from '../verification-handoff.js';
import { integrationPreview, fastForwardCommand } from '../integration.js';
import { registerIntegration } from '../integration-command.js';
import { loadPreview } from '../planner.js';
import { verifyLane, checkout } from '../prepare.js';

async function fixture(t) {
  const f = await startupRetryFixture(t);
  f.flow.status = 'completed'; delete f.flow.retry;
  f.flow.lanes[0].completionReceipt = { id: 'receipt', summary: 'Done', delivery: 'pending' };
  await f.save();
  await writeFile(path.join(f.target, 'file.txt'), 'ready'); git(f.target, 'add', 'file.txt'); git(f.target, 'commit', '-m', 'ready');
  f.options.taskId = 'writer'; f.options.entries = [];
  return f;
}
async function validate(f) {
  const report = await verificationGuidance({ ...f.options, beforeIntegration: true });
  assert.equal(report.state, 'awaiting-independent-validation', report.blockers.join(' '));
  const requirements = [{ id: 'scope', instruction: 'Independently inspect the committed diff and content against the declared scope.' },
    ...report.requiredChecks.map((instruction, i) => ({ id: `check-${i + 1}`, instruction })),
    ...report.acceptance.map((instruction, i) => ({ id: `acceptance-${i + 1}`, instruction }))];
  const intent = { kind: 'verification-handoff', handoffId: 'validation', beforeIntegration: true,
    workflowId: report.workflowId, commit: report.evidence.commit, fingerprint: verificationFingerprint(report), requirements };
  const input = { path: path.join(f.target, 'file.txt') };
  f.options.records.push(intent, { kind: 'verification-tool-call', handoffId: intent.handoffId, toolCallId: 'read', toolName: 'read', input },
    { kind: 'verification-tool-result', handoffId: intent.handoffId, toolCallId: 'read', input, isError: false });
  f.options.entries = [{ type: 'custom', customType: 'forgeflow-adapter', data: intent },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'read', name: 'read', arguments: input }] } },
    { id: 'read-result', type: 'message', message: { role: 'toolResult', toolCallId: 'read', toolName: 'read', isError: false,
      content: [{ type: 'text', text: await readFile(input.path, 'utf8') }] } }];
  const draft = buildVerificationDraft(intent, requirements.map(r => ({ requirementId: r.id, outcome: 'pass', summary: 'Fixture assessment', toolCallIds: ['read'] })),
    collectVerificationEvidence(intent, f.options.records, f.options.entries));
  f.options.records.push(draft, { kind: 'verification-review-decision', handoffId: intent.handoffId, draftId: draft.draftId, decision: 'confirmed' },
    { kind: 'integration-validation', handoffId: intent.handoffId, draftId: draft.draftId, workflowId: intent.workflowId, commit: intent.commit, fingerprint: intent.fingerprint });
  return report;
}

test('pre-integration inspection preserves final verification gate and requires real accepted evidence', async t => {
  const f = await fixture(t), before = await readFile(f.manifestPath);
  assert.match((await verificationGuidance(f.options)).blockers.join(' '), /not integrated/);
  let report = await integrationPreview(f.options);
  assert.equal(report.state, 'blocked'); assert.match(report.blockers.join(' '), /validation draft/);
  await validate(f);
  const records = structuredClone(f.options.records);
  report = await integrationPreview(f.options);
  assert.equal(report.state, 'ready-for-native-approval', report.blockers.join(' '));
  assert.equal(report.command, fastForwardCommand(report.destination.root, report.evidence.commit));
  assert.equal(report.executed, false);
  assert.deepEqual(f.options.records, records); assert.deepEqual(await readFile(f.manifestPath), before);
  assert.notEqual(git(f.options.cwd, 'rev-parse', 'HEAD'), report.evidence.commit);
  f.options.entries.at(-1).message.content[0].text = 'replaced output';
  assert.match((await integrationPreview(f.options)).blockers.join(' '), /evidence/);
});

test('dirty work, missing receipts, scope changes, divergence and foreign ownership block integration', async t => {
  const f = await fixture(t); await validate(f);
  assert.equal((await integrationPreview({ ...f.options, sessionFile: '/foreign' })).state, 'blocked');
  delete f.flow.lanes[0].completionReceipt; await f.save();
  assert.equal((await integrationPreview(f.options)).state, 'blocked');
  f.flow.lanes[0].completionReceipt = { id: 'receipt', summary: 'Done' }; await f.save();
  await writeFile(path.join(f.target, 'file.txt'), 'dirty');
  assert.match((await integrationPreview(f.options)).blockers.join(' '), /uncommitted/);
  await writeFile(path.join(f.target, 'file.txt'), 'ready');
  await writeFile(path.join(f.options.cwd, 'other.txt'), 'new destination commit');
  git(f.options.cwd, 'add', 'other.txt'); git(f.options.cwd, 'commit', '-m', 'diverge');
  assert.match((await integrationPreview(f.options)).blockers.join(' '), /diverged/);
});

test('already integrated is a no-op and dependent review requires final verification', async t => {
  const f = await fixture(t);
  const review = path.join(path.dirname(f.target), 'review'); git(f.options.cwd, 'worktree', 'add', '-b', 'review', review);
  const brief = JSON.parse(await readFile(f.options.filename));
  brief.tasks.push({ ...brief.tasks[0], id: 'review', readOnly: true, dependsOn: ['writer'], worktreeCwd: review });
  await writeFile(f.options.filename, JSON.stringify(brief));
  const preview = await loadPreview(f.options.filename, { cwd: f.options.cwd });
  for (const record of f.options.records) if (record.sourceSha256) record.sourceSha256 = preview.sourceSha256;
  await validate(f);
  const first = await integrationPreview(f.options); assert.equal(first.state, 'ready-for-native-approval');
  git(f.options.cwd, 'merge', '--ff-only', first.evidence.commit);
  assert.equal((await integrationPreview(f.options)).state, 'already-integrated');
  assert.match((await integrationPreview({ ...f.options, reviewTaskId: 'review' })).blockers.join(' '), /final writer verification/);
  const mapped = f.options.records.find(item => item.kind === 'planned');
  f.options.records.push(await verifyLane({ mapped, commit: first.evidence.commit, evidence: 'Fixture root validation', cwd: f.options.cwd, env: f.options.env }));
  let next = await integrationPreview({ ...f.options, reviewTaskId: 'review' });
  assert.equal(next.state, 'ready-for-native-approval', next.blockers.join(' '));
  assert.equal(next.destination.root, await realpath(review));
  git(review, 'merge', '--ff-only', first.evidence.commit);
  next = await integrationPreview({ ...f.options, reviewTaskId: 'review' });
  assert.equal(next.state, 'already-integrated'); assert.match(next.next, /prepare-lane/);
  f.options.records.push({ kind: 'planned', sourcePath: preview.sourcePath, root: mapped.root, taskId: 'review' });
  assert.match((await integrationPreview({ ...f.options, reviewTaskId: 'review' })).blockers.join(' '), /already has preparation/);
});

test('native command grammar rejects shell expansion and normalizes Windows paths', () => {
  const commit = 'a'.repeat(40);
  assert.equal(fastForwardCommand('C:\\work tree\\app', commit), `rtk proxy git -C "C:/work tree/app" merge --ff-only ${commit}`);
  for (const name of ['/tmp/$(secret)', '/tmp/x";echo secret', '/tmp/x\ncommand', '/tmp/a`whoami`'])
    assert.throws(() => fastForwardCommand(name, commit), /grammar/);
});

function commandFixture() {
  const commands = new Map(), hooks = new Map(), records = [], notices = [], messages = [];
  const destination = { root: '/application', head: 'a'.repeat(40), branch: 'main', commonDir: '/application/.git' };
  const report = { state: 'ready-for-native-approval', blockers: [], fingerprint: 'same', sourcePath: '/brief.json', sourceSha256: 'brief',
    current: { root: '/controller' }, taskId: 'writer', workflowId: 'flow', reviewTaskId: null, destination,
    evidence: { commit: 'b'.repeat(40), target: { root: '/writer' }, repository: destination }, command: fastForwardCommand(destination.root, 'b'.repeat(40)) };
  const ctx = { cwd: '/controller', hasUI: true, isIdle: () => true, sessionManager: { getSessionFile: () => '/session', getBranch: () => [] },
    ui: { confirm: async () => true, notify: text => notices.push(text) } };
  const pi = { registerCommand: (name, cmd) => commands.set(name, cmd), registerTool() {}, on: (name, hook) => hooks.set(name, hook),
    appendEntry: (_type, record) => records.push(record), getActiveTools: () => ['bash'], sendMessage: (...args) => messages.push(args) };
  const install = () => registerIntegration(pi, () => records, async () => structuredClone(report), async () => ({ readiness: { root: 'same' } }),
    async () => ({ ...destination, head: report.evidence.commit })); install();
  return { commands, hooks, records, report, ctx, notices, messages, pi, install,
    start: () => commands.get('forgeflow-integrate-once').handler('"/brief.json" writer', ctx),
    call: (input = { command: report.command }, id = 'call') => hooks.get('tool_call')({ toolName: 'bash', input, toolCallId: id }, ctx) };
}

test('one native handoff rechecks and records a successful exact merge then blocks replay', async () => {
  const f = commandFixture(); await f.start(); assert.equal(f.records[0].kind, 'integration-intent');
  assert.equal(f.messages[0][1].triggerTurn, true);
  assert.equal((await f.call({ command: f.report.command + ' && echo bad' })).block, true);
  assert.equal(await f.call(), undefined);
  assert.equal((await f.call(undefined, 'second')).block, true);
  await f.hooks.get('tool_result')({ toolName: 'bash', toolCallId: 'call', isError: false }, f.ctx);
  assert.equal(f.records.at(-1).outcome, 'integrated');
  f.hooks.get('agent_end')(); assert.equal((await f.call()).block, true);
  await f.start(); assert.equal(f.records.filter(r => r.kind === 'integration-intent').length, 1);
});

test('cancel, state drift, audit failure and reload cannot execute or repeat integration', async () => {
  const cancelled = commandFixture(); cancelled.ctx.ui.confirm = async () => false; await cancelled.start(); assert.equal(cancelled.records.length, 0);
  const drift = commandFixture(); await drift.start(); drift.report.fingerprint = 'changed'; assert.equal((await drift.call()).block, true);
  const reload = commandFixture(); await reload.start(); reload.install(); assert.equal((await reload.call()).block, true);
  const failed = commandFixture(); await failed.start(); failed.pi.appendEntry = () => { throw new Error('disk failure'); };
  assert.equal((await failed.call()).block, true);
  const error = commandFixture(); await error.start(); await error.call();
  await error.hooks.get('tool_result')({ toolName: 'bash', toolCallId: 'call', isError: true }, error.ctx);
  assert.equal(error.records.at(-1).outcome, 'unknown');
});

test('preview registration does not arm execution and native ownership failure creates no intent', async () => {
  const f = commandFixture();
  await f.commands.get('forgeflow-integration-preview').handler('"/brief.json" writer', f.ctx);
  assert.equal(f.records.length, 0); assert.equal(f.messages[0][1].triggerTurn, false);
  await f.commands.get('forgeflow-integrate-once').handler('"/brief.json" writer\nrun more', f.ctx);
  assert.equal(f.records.length, 0);
  registerIntegration(f.pi, () => f.records, async () => f.report, async () => { throw new Error('wrong owning root'); });
  await f.start(); assert.equal(f.records.length, 0);
  assert.match(f.notices.at(-1), /wrong owning root/);
});
