import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { registerVerificationHandoff } from '../verification-handoff.js';
Object.assign(process.env, { HERDR_ENV: '1', HERDR_PANE_ID: 'p', HERDR_WORKSPACE_ID: 'w' });

function fixture() {
  const entries = [], commands = new Map(), tools = new Map(), hooks = new Map(), messages = [], notices = [], saves = [];
  const root = realpathSync(process.cwd());
  const report = { state: 'awaiting-independent-validation', blockers: [], sourcePath: path.join(root, 'brief.json'),
    sourceSha256: 'brief', manifestPath: path.join(root, '.baa-ton/herdr-orchestrator/manifest.json'),
    taskId: 'writer', workflowId: 'herdr-one', current: { root, sessionFile: path.join(root, 'session'), paneId: 'p', workspaceId: 'w', inHerdr: true },
    requiredChecks: ['Run tests'], acceptance: ['Correct text'], evidence: { commit: 'a'.repeat(40), baseline: 'b'.repeat(40),
      integrated: true, committedPaths: ['status.txt'], target: { head: 'a'.repeat(40), status: '' }, repository: { head: 'a'.repeat(40), status: '' } } };
  let approve = true;
  const records = () => entries.filter(entry => entry.type === 'custom' && entry.customType === 'forgeflow-adapter').map(entry => entry.data);
  const pi = { registerCommand: (name, value) => commands.set(name, value), registerTool: tool => tools.set(tool.name, tool),
    getActiveTools: () => [...tools.keys()],
    on: (name, handler) => hooks.set(name, handler), sendMessage: (...args) => messages.push(args),
    appendEntry: (customType, data) => entries.push({ id: `entry-${entries.length}`, type: 'custom', customType, data }) };
  const ctx = { cwd: root, hasUI: true, isIdle: () => true,
    sessionManager: { getBranch: () => entries, getSessionFile: () => report.current.sessionFile },
    ui: { notify: (...args) => notices.push(args), confirm: async () => approve } };
  const save = async (params, _ctx, provenance) => { saves.push(params); pi.appendEntry('forgeflow-adapter', { kind: 'verified', ...params, ...provenance }); };
  const install = (saver = save, inspector = async () => structuredClone(report)) => registerVerificationHandoff(pi, records, saver, inspector);
  const guard = install();
  const intent = () => records().findLast(item => item.kind === 'verification-handoff');
  const start = () => commands.get('forgeflow-verification-handoff').handler('"brief.json" writer', ctx);
  const invoke = (name, params) => tools.get(name).execute('tool', params, undefined, undefined, ctx);
  const call = async (id = 'check', isError = false, toolName = 'bash') => {
    const input = toolName === 'read' ? { path: 'status.txt' } : { command: 'run the fixture checks' };
    entries.push({ id: `call-${id}`, type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id, name: toolName, arguments: input }] } });
    const blocked = await hooks.get('tool_call')({ toolName, toolCallId: id, input }, ctx);
    if (!blocked) {
      hooks.get('tool_result')({ toolName, toolCallId: id, input, isError }, ctx);
      entries.push({ id: `result-${id}`, type: 'message', message: { role: 'toolResult', toolName, toolCallId: id, isError, content: [{ type: 'text', text: isError ? 'Checks failed' : 'Checks passed; inspected ready text' }] } });
    }
    return blocked;
  };
  const assessments = (id = 'check', outcome = 'pass') => intent().requirements.map(item => ({ requirementId: item.id, outcome, summary: 'Root inspected this requirement', toolCallIds: id ? [id] : [] }));
  const draft = (results = assessments()) => invoke('forgeflow_draft_verification', { handoffId: intent().handoffId, results });
  const review = () => commands.get('forgeflow-review-verification').handler('', ctx);
  return { entries, records, commands, tools, hooks, messages, notices, saves, report, pi, ctx, guard, install,
    intent, start, call, invoke, assessments, draft, review, set approve(value) { approve = value; } };
}

test('handoff collects actual root results, drafts, and saves only after user review', async () => {
  const f = fixture(); await f.start();
  assert.equal(f.messages[0][1].triggerTurn, true);
  assert.match(f.messages[0][0].content, /No edits, commit, integration/);
  assert.equal(await f.call(), undefined);
  const evidence = (await f.invoke('forgeflow_verification_evidence', { handoffId: f.intent().handoffId })).details.evidence;
  assert.equal(evidence[0].resultEntryId, 'result-check');
  const drafted = (await f.draft()).details;
  assert.equal(drafted.eligible, true); assert.equal(f.saves.length, 0);
  assert.throws(() => f.guard.assertDirectVerificationAllowed(f.ctx), /Review the active/);
  assert.equal((await f.call('after-draft')).block, true);
  f.approve = false; await f.review(); assert.equal(f.saves.length, 0);
  f.approve = true; await f.review();
  assert.equal(f.saves.length, 1);
  assert.match(f.saves[0].evidence, /result-check/);
  assert.equal(f.records().at(-1).verificationDraftId, drafted.draftId);
  assert.equal(f.messages.at(-1)[1].triggerTurn, false);
  await f.review(); assert.equal(f.saves.length, 1);
});

test('blocked prerequisites, unavailable UI and outstanding dispatch create no validation turn', async () => {
  for (const alter of [f => { f.report.state = 'blocked'; f.report.blockers = ['Uncommitted change']; },
    f => { f.ctx.hasUI = false; }, f => { f.ctx.isIdle = () => false; }, f => { f.pi.getActiveTools = () => []; },
    f => { f.pi.appendEntry('forgeflow-adapter', { kind: 'dispatch-intent', intentId: 'pending' }); }]) {
    const f = fixture(); alter(f); await f.start();
    assert.equal(f.messages.length, 0); assert.equal(f.intent(), undefined);
  }
});

test('draft requires every requirement and rejects invented or pre-handoff tool references', async () => {
  const f = fixture();
  f.entries.push({ type: 'message', message: { role: 'toolResult', toolCallId: 'old', toolName: 'bash', isError: false, content: [{ type: 'text', text: 'old run' }] } });
  await f.start(); await f.call();
  for (const results of [[], [f.assessments()[0], f.assessments()[0], f.assessments()[0]], f.assessments('old'), f.assessments('invented'), f.assessments(null)])
    await assert.rejects(f.draft(results));
  assert.equal(f.records().some(item => item.kind === 'verification-draft'), false);
  const result = (await f.draft(f.assessments(null, 'blocked'))).details;
  assert.equal(result.eligible, false);
  await f.review(); assert.equal(f.saves.length, 0);
});

test('failures cannot be relabeled pass or omitted from an eligible draft', async () => {
  const f = fixture(); await f.start(); await f.call('failed', true);
  await assert.rejects(f.draft(f.assessments('failed')), /failed or unknown/);
  await f.call('retry', false);
  const draft = (await f.draft(f.assessments('retry'))).details;
  assert.equal(draft.eligible, false); assert.equal(draft.evidence.length, 2);
  await f.review(); assert.equal(f.saves.length, 0);
});

test('missing or ambiguous actual tool results block drafting', async () => {
  for (const change of [f => { f.entries.pop(); }, f => { f.entries.push(structuredClone(f.entries.at(-1))); },
    f => { f.entries.at(-1).message.toolName = 'foreign'; }]) {
    const f = fixture(); await f.start(); await f.call(); change(f);
    await assert.rejects(f.draft(), /Missing or ambiguous/);
  }
});

test('changed checkout, brief, manifest, session or evidence prevents saving', async () => {
  for (const change of [f => { f.report.evidence.commit = 'c'.repeat(40); }, f => { f.report.sourceSha256 = 'changed'; },
    f => { f.report.manifestPath = 'different'; }, f => { f.report.current.sessionFile = 'foreign'; },
    f => { f.entries.find(e => e.id === 'result-check').message.content[0].text = 'tampered result'; }]) {
    const f = fixture(); await f.start(); await f.call(); await f.draft(); change(f); await f.review();
    assert.equal(f.saves.length, 0);
  }
  const f = fixture(); await f.start(); await f.call(); await f.draft();
  f.ctx.ui.confirm = async () => { f.report.evidence.repository.head = 'changed'; return true; };
  await f.review(); assert.equal(f.saves.length, 0);
});

test('reload cannot resume validation implicitly but can review a preserved draft', async () => {
  const f = fixture(); await f.start(); f.install();
  assert.equal((await f.call()).block, true);
  await f.commands.get('forgeflow-cancel-verification').handler('', f.ctx);
  assert.equal(f.records().at(-1).kind, 'verification-cancelled');
  await f.start(); await f.call('new'); await f.draft(f.assessments('new')); f.install();
  await f.review(); assert.equal(f.saves.length, 1);
});

test('handoff rejects unrelated native writes and preserves explicit cancellation history', async () => {
  const f = fixture(); await f.start();
  for (const toolName of ['herdr_dispatch', 'forgeflow_verify_lane', 'write', 'edit', 'spawn_agent'])
    assert.equal((await f.hooks.get('tool_call')({ toolName, toolCallId: toolName, input: {} }, f.ctx)).block, true);
  const before = f.records().length;
  await f.commands.get('forgeflow-cancel-verification').handler('', f.ctx);
  assert.equal(f.records().length, before + 1);
  assert.doesNotThrow(() => f.guard.assertDirectVerificationAllowed(f.ctx));
});

test('audit errors fail closed and an uncertain save is not retried', async () => {
  const f = fixture(); await f.start();
  f.pi.appendEntry = () => { throw new Error('disk full'); };
  assert.equal((await f.call()).block, true); assert.equal(f.saves.length, 0);
  const g = fixture(); await g.start(); await g.call(); await g.draft();
  let attempts = 0;
  g.install(async () => { attempts++; throw new Error('save unavailable'); });
  await g.review(); await g.review();
  assert.equal(attempts, 1);
  assert.match(g.notices.at(-1)[0], /already attempted/);
});

test('concurrent start and review requests cannot duplicate a handoff or verification', async () => {
  const f = fixture(); await Promise.all([f.start(), f.start()]);
  assert.equal(f.records().filter(item => item.kind === 'verification-handoff').length, 1);
  await f.call(); await f.draft(); await Promise.all([f.review(), f.review()]);
  assert.equal(f.saves.length, 1);
});

test('effective argument changes and failed handoff delivery cannot silently produce evidence', async () => {
  const f = fixture(); await f.start(); await f.call();
  f.records().find(item => item.kind === 'verification-tool-result').input.command = 'different execution';
  await assert.rejects(f.draft(), /Missing or ambiguous/);
  const g = fixture(); g.pi.sendMessage = () => { throw new Error('delivery failed'); };
  await g.start();
  assert.equal(g.records().at(-1).kind, 'verification-handoff');
  assert.equal((await g.call()).block, true);
  assert.equal(g.saves.length, 0);
});

test('the owning user can cancel after a broken brief without adopting foreign pane identity', async () => {
  const f = fixture(); await f.start();
  f.install(undefined, async () => { throw new Error('brief unavailable'); });
  process.env.HERDR_PANE_ID = 'foreign';
  try {
    await f.commands.get('forgeflow-cancel-verification').handler('', f.ctx);
    assert.equal(f.records().at(-1).kind, 'verification-handoff');
  } finally { process.env.HERDR_PANE_ID = 'p'; }
  await f.commands.get('forgeflow-cancel-verification').handler('', f.ctx);
  assert.equal(f.records().at(-1).kind, 'verification-cancelled');
});
