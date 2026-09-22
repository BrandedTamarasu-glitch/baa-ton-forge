import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { registerVerificationHandoff } from '../verification-handoff.js';
import { registerVerificationAudit, verificationAudit, renderVerificationAudit } from '../verification-audit.js';
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
    const input = { read: { path: 'status.txt' }, grep: { pattern: 'ready' },
      find: { pattern: '*.txt' }, ls: {} }[toolName] ?? { command: 'run the fixture checks' };
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

test('pre-integration validation closes its handoff without saving final verification', async () => {
  const f = fixture(), inspected = [];
  f.report.evidence.integrated = false;
  f.install(undefined, async options => { inspected.push(options.beforeIntegration); return structuredClone(f.report); });
  await f.commands.get('forgeflow-verification-handoff').handler('"brief.json" writer --before-integration', f.ctx);
  assert.equal(f.intent().beforeIntegration, true);
  await f.call(); await f.draft();
  f.approve = false; await f.review();
  assert.equal(f.records().some(item => item.kind === 'integration-validation'), false);
  f.approve = true; await f.review();
  assert.equal(f.records().at(-1).kind, 'integration-validation');
  assert.equal(f.saves.length, 0);
  assert.equal(f.records().some(item => item.kind === 'verified'), false);
  assert.ok(inspected.every(value => value === true));
  assert.equal(await f.hooks.get('tool_call')({ toolName: 'forgeflow_integration_preview' }, f.ctx), undefined);
  await f.review(); assert.equal(f.records().filter(item => item.kind === 'integration-validation').length, 1);
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

test('native optional-null normalization preserves actual result provenance', async () => {
  for (const [toolName, optional] of [['read', { offset: null, limit: null }], ['bash', { timeout: null }],
    ['grep', { path: null, glob: null, ignoreCase: null, literal: null, context: null, limit: null }],
    ['find', { path: null, limit: null }], ['ls', { path: null, limit: null }]]) {
    const f = fixture(); await f.start(); await f.call('check', false, toolName);
    const call = f.entries.find(entry => entry.id === 'call-check').message.content[0];
    call.arguments = { ...call.arguments, ...optional };
    const before = structuredClone(f.entries);
    const evidence = (await f.invoke('forgeflow_verification_evidence', { handoffId: f.intent().handoffId })).details.evidence;
    assert.equal(evidence[0].resultEntryId, 'result-check');
    assert.deepEqual(evidence[0].input, f.records().find(item => item.kind === 'verification-tool-call').input);
    assert.deepEqual(f.entries, before);
    assert.equal((await f.draft()).details.eligible, true);
  }
});

test('normalization rejects removed non-null, required or unknown arguments and changed results', async () => {
  for (const alter of [
    call => { call.arguments.offset = 1; },
    call => { call.arguments.path = null; },
    call => { call.arguments.unknown = null; },
    (call, f) => { call.arguments.offset = null; f.records().find(item => item.kind === 'verification-tool-result').input = { path: 'elsewhere' }; },
  ]) {
    const f = fixture(); await f.start(); await f.call('check', false, 'read');
    const call = f.entries.find(entry => entry.id === 'call-check').message.content[0];
    call.arguments = { ...call.arguments }; alter(call, f);
    await assert.rejects(f.draft(), /Missing or ambiguous/);
  }
  const f = fixture(); await f.start(); await f.call('check', true, 'read');
  const call = f.entries.find(entry => entry.id === 'call-check').message.content[0];
  call.arguments = { ...call.arguments, offset: null };
  await assert.rejects(f.draft(), /failed or unknown/);
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

test('verification audit exposes fresh evidence, declined and confirmed review, and saved provenance without mutation', async () => {
  const f = fixture(); await f.start(); await f.call(); await f.draft();
  registerVerificationAudit(f.pi);
  assert.equal(await f.hooks.get('tool_call')({ toolName: 'forgeflow_verification_audit', input: {} }, f.ctx), undefined);
  f.approve = false; await f.review();
  let report = verificationAudit(f.entries, { current: f.report.current });
  assert.equal(report.handoffs[0].state, 'draft-awaiting-save');
  assert.equal(report.handoffs[0].decisions[0].decision, 'declined');
  assert.equal(report.verifications.length, 0);
  f.approve = true; await f.review();
  const before = structuredClone(f.entries), saves = f.saves.length;
  f.ctx.ui.confirm = () => { throw new Error('Audit must not ask for confirmation'); };
  f.pi.appendEntry = () => { throw new Error('Audit must not append records'); };
  f.pi.exec = () => { throw new Error('Audit must not execute a command'); };
  report = (await f.invoke('forgeflow_verification_audit', { workflowId: 'herdr-one' })).details;
  assert.equal(report.handoffs[0].state, 'saved');
  assert.equal(report.handoffs[0].context, 'recorded-context-matches');
  assert.equal(report.handoffs[0].saves[0].confirmation, 'recorded-confirmation');
  assert.deepEqual(report.handoffs[0].gaps, []);
  assert.equal(report.handoffs[0].toolEvidence[0].resultEntryId, 'result-check');
  assert.match(report.handoffs[0].toolEvidence[0].resultSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.verifications[0].method, 'handoff');
  await f.commands.get('forgeflow-verification-audit').handler('herdr-one', f.ctx);
  assert.equal(f.messages.at(-1)[1].triggerTurn, false);
  assert.deepEqual(f.messages.at(-1)[0].details, report);
  assert.deepEqual(f.entries, before); assert.equal(f.saves.length, saves);
});

test('audit distinguishes legacy inferred confirmation, direct saves and unknown older provenance', async () => {
  const f = fixture(); await f.start(); await f.call(); await f.draft(); await f.review();
  const entries = f.entries.filter(entry => entry.data?.kind !== 'verification-review-decision');
  entries.push({ id: 'direct', type: 'custom', customType: 'forgeflow-adapter', data: {
    kind: 'verified', workflowId: 'herdr-one', commit: 'b'.repeat(40), verificationMethod: 'direct', verifiedAt: 'later' } });
  entries.push({ id: 'old', type: 'custom', customType: 'forgeflow-adapter', data: {
    kind: 'verified', workflowId: 'herdr-one', commit: 'c'.repeat(40) } });
  const report = verificationAudit(entries);
  assert.equal(report.handoffs[0].saves[0].confirmation, 'inferred-from-legacy-save-attempt');
  assert.deepEqual(report.verifications.map(item => item.method), ['handoff', 'direct', 'legacy-unattributed']);
  assert.match(renderVerificationAudit(report), /legacy-unattributed/);
});

test('audit preserves unresolved saves, cancellation and multiple workflow history', async () => {
  const f = fixture(); await f.start(); await f.call(); await f.draft();
  f.install(async () => { throw new Error('disk full'); }); await f.review();
  let report = verificationAudit(f.entries);
  assert.equal(report.handoffs[0].state, 'save-unresolved');
  assert.match(renderVerificationAudit(report), /no retry authorized/);
  const g = fixture(); await g.start(); await g.commands.get('forgeflow-cancel-verification').handler('', g.ctx);
  assert.equal(verificationAudit(g.entries).handoffs[0].state, 'cancelled');
  f.pi.appendEntry('forgeflow-adapter', { kind: 'verified', workflowId: 'herdr-other', verificationMethod: 'direct', commit: 'd'.repeat(40) });
  assert.equal(verificationAudit(f.entries).workflowId, 'herdr-other');
  report = verificationAudit(f.entries, { workflowId: 'herdr-one' });
  assert.equal(report.handoffs.length, 1); assert.equal(report.verifications.length, 0);
  const missing = verificationAudit(f.entries, { workflowId: 'herdr-missing' });
  assert.equal(missing.handoffs.length, 0); assert.match(missing.warnings.join(' '), /does not prove/);
});

test('audit reports gaps for missing, changed, ambiguous or contradictory evidence instead of claiming a chain', async () => {
  for (const change of [
    entries => entries.filter(e => e.data?.kind !== 'verification-handoff'),
    entries => entries.filter(e => e.data?.kind !== 'verification-draft'),
    entries => entries.filter(e => e.data?.kind !== 'verification-save-attempt'),
    entries => entries.filter(e => e.id !== 'result-check'),
    entries => { entries.find(e => e.id === 'result-check').message.content[0].text = 'Changed'; return entries; },
    entries => { entries.push(structuredClone(entries.find(e => e.data?.kind === 'verification-handoff'))); return entries; },
    entries => { entries.find(e => e.data?.kind === 'verified').data.commit = 'f'.repeat(40); return entries; },
    entries => { entries.find(e => e.data?.kind === 'verified').data.root = '/foreign'; return entries; },
    entries => { entries.find(e => e.data?.kind === 'verified').data.evidence = 'Different claims'; return entries; },
    entries => { entries.find(e => e.data?.kind === 'verification-review-decision').data.decision = 'declined'; return entries; },
    entries => { entries.find(e => e.data?.kind === 'verification-draft').data.assessments[0].toolCallIds = ['invented']; return entries; },
  ]) {
    const f = fixture(); await f.start(); await f.call(); await f.draft(); await f.review();
    const report = verificationAudit(change(structuredClone(f.entries)), { workflowId: 'herdr-one' });
    assert.equal(report.handoffs[0].state, 'evidence-gaps', JSON.stringify(report));
    assert.ok(report.handoffs[0].gaps.length);
    assert.match(renderVerificationAudit(report), /Gap:/);
  }
});

test('audit renders malformed draft assessments and incomplete saved provenance as gaps', async () => {
  const f = fixture(); await f.start(); await f.call(); await f.draft(); await f.review();
  f.records().find(item => item.kind === 'verification-draft').assessments = [{ id: 'scope', toolCallIds: 7 }, null];
  const report = verificationAudit(f.entries);
  assert.equal(report.handoffs[0].state, 'evidence-gaps');
  assert.doesNotThrow(() => renderVerificationAudit(report));
  const entries = [{ type: 'custom', customType: 'forgeflow-adapter', data: { kind: 'verified', workflowId: 'herdr-orphan', verificationDraftId: 'draft' } }];
  assert.deepEqual(verificationAudit(entries).verifications[0].gaps, ['Incomplete handoff/draft provenance.']);
});

test('audit does not adopt a different context or treat a new branch as proof of no verification', async () => {
  const f = fixture(); await f.start(); await f.call(); await f.draft();
  const report = verificationAudit(f.entries, { current: { ...f.report.current, sessionFile: '/different' } });
  assert.equal(report.handoffs[0].context, 'different-or-unestablished-context');
  assert.equal(report.handoffs[0].owner.sessionFile, f.report.current.sessionFile);
  registerVerificationAudit(f.pi);
  f.ctx.sessionManager.getBranch = () => [];
  assert.match((await f.invoke('forgeflow_verification_audit', {})).details.warnings.join(' '), /does not prove/);
  await assert.rejects(f.invoke('forgeflow_verification_audit', { workflowId: 'herdr-one', execute: true }), /only an optional/);
  const count = f.entries.length;
  await f.commands.get('forgeflow-verification-audit').handler('herdr-one extra', f.ctx);
  assert.equal(f.entries.length, count); assert.match(f.notices.at(-1)[0], /only an optional/);
});
