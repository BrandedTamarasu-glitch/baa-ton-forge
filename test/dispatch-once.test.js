import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { registerDispatchOnce } from '../dispatch-once.js';

function fixture() {
  const records = [], commands = new Map(), hooks = new Map(), messages = [], notices = [];
  const root = path.resolve('test-root');
  const report = { sourcePath: path.join(root, 'brief.json'), sourceSha256: 'hash',
    current: { root, sessionFile: path.join(root, 'session'), paneId: 'p', workspaceId: 'w' },
    proposedStep: { code: 'review-dispatch', taskId: 'writer', workflowId: 'herdr-one' },
    readiness: { state: 'passed', evidence: { profiles: [{ agentKind: 'pi', launchProfile: { provider: 'openai-codex', model: 'exact', auth: 'subscription' } }], targetHead: 'head' } } };
  let probes = 0, approve = true, available = true;
  const ctx = { cwd: root, hasUI: true, isIdle: () => true,
    sessionManager: { getSessionFile: () => report.current.sessionFile },
    ui: { confirm: async () => approve, notify: (...args) => notices.push(args) } };
  const pi = { registerCommand: (name, value) => commands.set(name, value), on: (name, handler) => hooks.set(name, handler),
    appendEntry: (_type, data) => records.push(data), sendMessage: (...args) => messages.push(args),
    getActiveTools: () => available ? ['herdr_dispatch'] : [] };
  const inspect = async () => { probes++; return structuredClone(report); };
  const install = () => registerDispatchOnce(pi, () => records, inspect);
  install();
  return { records, commands, hooks, messages, notices, report, ctx, install,
    get probes() { return probes; }, set approve(value) { approve = value; }, set available(value) { available = value; },
    start: () => commands.get('forgeflow-dispatch-once').handler('"brief.json"', ctx),
    call: (input = { workflowId: 'herdr-one', execute: true }, id = 'call-1', toolName = 'herdr_dispatch') => hooks.get('tool_call')({ toolName, input, toolCallId: id }, ctx),
    result: (details, isError = false) => hooks.get('tool_result')({ toolName: 'herdr_dispatch', toolCallId: 'call-1', details, isError, content: [{ type: 'text', text: 'native result' }] }, ctx) };
}

test('confirmation, fresh gate and native result produce one audited attempt then stop', async () => {
  const f = fixture(); await f.start();
  assert.equal(f.probes, 2);
  assert.equal(f.records[0].kind, 'dispatch-intent');
  assert.equal(f.records[0].approval, 'native-ui-confirmed');
  assert.deepEqual(f.records[0].arguments, { workflowId: 'herdr-one', execute: true });
  assert.equal(f.messages[0][1].triggerTurn, true);
  assert.equal(await f.call(), undefined);
  assert.equal(f.probes, 3);
  assert.equal(f.records[1].kind, 'dispatch-attempt');
  f.result({ workflow: { id: 'herdr-one' }, dispatched: true });
  assert.equal(f.records[2].outcome, 'dispatch-reported');
  assert.equal((await f.call({}, 'next', 'forgeflow_prepare_lane')).block, true);
  f.hooks.get('agent_end')();
  assert.equal((await f.call()).block, true);
  f.result({ workflow: { id: 'herdr-one' }, dispatched: true });
  assert.equal(f.records.length, 3);
  await f.start(); assert.equal(f.messages.length, 1);
  await f.commands.get('forgeflow-dispatch-audit').handler('', f.ctx);
  assert.equal(f.messages.at(-1)[1].triggerTurn, false);
  assert.equal(f.messages.at(-1)[0].details.audit.length, 3);
});

test('cancel, missing native tool, noninteractive root and readiness failure never queue dispatch', async () => {
  for (const alter of [f => { f.approve = false; }, f => { f.available = false; },
    f => { f.ctx.hasUI = false; }, f => { f.report.readiness.state = 'blocked'; },
    f => { f.report.proposedStep.code = 'verify-completion'; }]) {
    const f = fixture(); alter(f); await f.start();
    assert.equal(f.records.length, 0); assert.equal(f.messages.length, 0);
  }
});

test('wrong calls cannot substitute workflow, restart, confirm override or another tool', async () => {
  const f = fixture(); await f.start();
  for (const input of [{ workflowId: 'other', execute: true }, { workflowId: 'herdr-one', execute: true, restart: true },
    { workflowId: 'herdr-one', execute: true, confirm: true }, { workflowId: 'herdr-one', execute: false }])
    assert.equal((await f.call(input)).block, true);
  assert.equal((await f.call({}, 'bad', 'bash')).block, true);
  assert.equal(f.records.length, 1);
});

test('changed evidence consumes the handoff without dispatch; reload cannot retry an uncertain attempt', async () => {
  const f = fixture(); await f.start(); f.report.readiness.evidence.targetHead = 'changed';
  assert.equal((await f.call()).block, true);
  assert.equal(f.records.at(-1).kind, 'dispatch-blocked');
  assert.equal((await f.call()).block, true);
  const g = fixture(); await g.start(); await g.call(); g.install();
  await g.start(); assert.equal(g.messages.length, 1);
  assert.equal((await g.call(undefined, 'retry')).block, true);
});

test('changed evidence while confirming creates no intent', async () => {
  const f = fixture(); f.ctx.ui.confirm = async () => { f.report.current.sessionFile = 'foreign'; return true; };
  await f.start(); assert.equal(f.records.length, 0); assert.equal(f.messages.length, 0);
});

test('error, cancelled, approval and malformed results never claim dispatch success', async () => {
  for (const [details, error, outcome] of [
    [{}, true, 'error'], [{ workflow: { id: 'herdr-one' }, cancelled: true }, false, 'cancelled'],
    [{ workflow: { id: 'herdr-one' }, parentApprovalRequired: true }, false, 'approval-required'],
    [{ workflow: { id: 'foreign' }, dispatched: true }, false, 'unknown'],
    [{ workflow: { id: 'herdr-one' }, dryRun: true, dispatched: true }, false, 'unknown'],
  ]) {
    const f = fixture(); await f.start(); await f.call(); f.result(details, error);
    assert.equal(f.records.at(-1).outcome, outcome);
    assert.equal(f.records.some(item => item.kind === 'verified'), false);
  }
});

test('concurrent confirmations and tool calls cannot create duplicate intents or attempts', async () => {
  const f = fixture();
  await Promise.all([f.start(), f.start()]);
  assert.equal(f.records.filter(item => item.kind === 'dispatch-intent').length, 1);
  const results = await Promise.all([f.call(undefined, 'first'), f.call(undefined, 'second')]);
  assert.equal(results.filter(item => item?.block).length, 1);
  assert.equal(f.records.filter(item => item.kind === 'dispatch-attempt').length, 1);
});
