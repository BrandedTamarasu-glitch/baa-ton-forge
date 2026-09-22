import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { buildPreview } from '../planner.js';
import { normalizeAcceptanceScopes, scopedAcceptance, acceptanceScopeDraft } from '../acceptance.js';
import { registerAcceptanceScope } from '../acceptance-command.js';

const scopes = [
  { requirementId: 'acceptance-1', taskIds: ['writer', 'review'], phase: 'pre-integration' },
  { requirementId: 'acceptance-2', taskIds: ['writer'], phase: 'final' },
  { requirementId: 'acceptance-3', taskIds: ['review'], phase: 'final' },
];
const brief = () => ({ version: 1, objective: 'Test phased acceptance',
  acceptance: ['Marker is correct', 'Application contains writer commit', 'Reviewer saw integrated checkout'],
  tasks: ['writer', 'review'].map(id => ({ id, objective: id, files: ['file'], checks: ['check file'],
    worktreeCwd: path.resolve(id), readOnly: id === 'review', dependsOn: id === 'review' ? ['writer'] : [] })) });
const preview = () => ({ ...buildPreview(brief()), sourcePath: path.resolve('brief.json'), sourceSha256: 'snapshot' });
const current = () => ({ root: realpathSync(process.cwd()), sessionFile: path.resolve('session'), paneId: 'p', workspaceId: 'w', inHerdr: true });

test('scoped acceptance breaks the writer/reviewer cycle without dropping later requirements', () => {
  const p = buildPreview({ ...brief(), acceptanceScopes: scopes });
  const pre = scopedAcceptance(p, { taskId: 'writer', beforeIntegration: true });
  assert.deepEqual(pre.applicableAcceptance.map(r => r.id), ['acceptance-1']);
  assert.deepEqual(pre.deferredAcceptance.map(r => [r.id, r.reason]), [['acceptance-2', 'later-phase'], ['acceptance-3', 'other-task']]);
  const final = scopedAcceptance(p, { taskId: 'writer' });
  assert.deepEqual(final.applicableAcceptance.map(r => r.id), ['acceptance-1', 'acceptance-2']);
  const review = scopedAcceptance(p, { taskId: 'review' });
  assert.deepEqual(review.applicableAcceptance.map(r => r.id), ['acceptance-1', 'acceptance-3']);
  assert.deepEqual(scopedAcceptance(preview(), { taskId: 'writer' }), {});
  assert.match(p.workflows[0].planArguments.lanes[0].objective, /root validation: writer; final/);
});

test('omitted criteria, invented IDs/tasks, unknown fields and check deferrals fail closed', () => {
  const p = preview();
  for (const change of [s => s.pop(), s => { s[1] = s[0]; }, s => { s[0].requirementId = 'check-1'; },
    s => { s[0].taskIds = []; }, s => { s[0].taskIds = ['missing']; }, s => { s[0].taskIds = ['writer', 'writer']; },
    s => { s[0].phase = 'later'; }, s => { s[0].instruction = 'changed'; }, s => { s[0] = null; }]) {
    const bad = structuredClone(scopes); change(bad);
    assert.throws(() => normalizeAcceptanceScopes(p.acceptance, ['writer', 'review'], bad));
  }
});

test('session scope is tied to original text, snapshot, owner and unique proposal evidence', () => {
  const p = preview(), owner = current(), draft = acceptanceScopeDraft(p, owner, scopes);
  const records = [{ kind: 'acceptance-scope-draft', draft }, { kind: 'acceptance-scope', ...draft }];
  assert.equal(scopedAcceptance(p, { current: owner, records, taskId: 'writer', beforeIntegration: true }).applicableAcceptance.length, 1);
  for (const change of [r => r.pop(), r => r.shift(), r => r.push(structuredClone(r[1])),
    r => { r[1].scopes[0].phase = 'final'; }, r => { r[0].draft.acceptance[0] = 'rewritten'; }]) {
    const changed = structuredClone(records); change(changed);
    if (!changed.some(r => r.kind === 'acceptance-scope')) {
      // An unaccepted proposal never changes the legacy requirements.
      assert.deepEqual(scopedAcceptance(p, { current: owner, records: changed, taskId: 'writer' }), {});
    } else assert.throws(() => scopedAcceptance(p, { current: owner, records: changed, taskId: 'writer' }));
  }
  for (const key of ['root', 'sessionFile', 'paneId', 'workspaceId'])
    assert.throws(() => scopedAcceptance(p, { current: { ...owner, [key]: 'different' }, records, taskId: 'writer' }), /provenance/);
  assert.throws(() => scopedAcceptance({ ...p, sourceSha256: 'different' }, { current: owner, records, taskId: 'writer' }), /provenance/);
  assert.throws(() => scopedAcceptance({ ...p, acceptanceScopes: scopes }, { current: owner, records, taskId: 'writer' }), /Conflicting/);
});

function commandFixture() {
  Object.assign(process.env, { HERDR_ENV: '1', HERDR_PANE_ID: 'p', HERDR_WORKSPACE_ID: 'w' });
  const p = preview(), owner = current(), records = [], tools = new Map(), commands = new Map(), notices = [], confirmations = [];
  let proofFails = false, open = false;
  const ctx = { cwd: owner.root, hasUI: true, isIdle: () => true,
    sessionManager: { getSessionFile: () => owner.sessionFile },
    ui: { notify: text => notices.push(text), confirm: async (...args) => { confirmations.push(args); return true; } } };
  const pi = { registerTool: tool => tools.set(tool.name, tool), registerCommand: (name, cmd) => commands.set(name, cmd),
    appendEntry: (_type, record) => records.push(record) };
  const install = () => registerAcceptanceScope(pi, () => records, {
    proveRoot: async () => { if (proofFails) throw new Error('Native ownership mismatch'); },
    assertIdleHandoff: () => { if (open) throw new Error('Cancel the active handoff'); }, inspectBrief: async () => structuredClone(p),
  });
  install();
  return { p, owner, records, ctx, notices, confirmations, install,
    propose: () => tools.get('forgeflow_preview_acceptance_scope').execute('preview', { filename: p.sourcePath, scopes }, undefined, undefined, ctx),
    accept: id => commands.get('forgeflow-accept-acceptance-scope').handler(id, ctx),
    set proofFails(value) { proofFails = value; }, set open(value) { open = value; } };
}

test('legacy adoption preserves a blocked draft/receipt and requires separate native confirmation', async () => {
  const f = commandFixture();
  f.records.push({ kind: 'verification-handoff', handoffId: 'old', sourcePath: f.p.sourcePath },
    { kind: 'verification-draft', handoffId: 'old', eligible: false, assessments: [{ id: 'acceptance-2', outcome: 'blocked' }] },
    { kind: 'verification-cancelled', handoffId: 'old' }, { kind: 'receipt-fixture', id: 'preserved' });
  const before = structuredClone(f.records);
  const { details: draft } = await f.propose(); await f.propose();
  assert.equal(f.records.filter(r => r.kind === 'acceptance-scope-draft').length, 1);
  assert.equal(f.records.some(r => r.kind === 'acceptance-scope'), false);
  f.ctx.ui.confirm = async () => false; await f.accept(draft.draftId);
  assert.equal(f.records.some(r => r.kind === 'acceptance-scope'), false);
  f.ctx.ui.confirm = async () => true; f.install(); await f.accept(draft.draftId);
  assert.equal(f.records.filter(r => r.kind === 'acceptance-scope').length, 1);
  assert.deepEqual(f.records.slice(0, before.length), before);
  await f.accept(draft.draftId);
  assert.equal(f.records.filter(r => r.kind === 'acceptance-scope').length, 1);
  assert.match(f.notices.at(-1), /immutable/);
});

test('adoption rejects active validation, changed evidence, foreign owner and late rescoping', async () => {
  const f = commandFixture(); f.open = true; await assert.rejects(f.propose(), /active handoff/);
  f.open = false; f.proofFails = true; await assert.rejects(f.propose(), /ownership/);
  for (const mutate of [g => { g.p.sourceSha256 = 'new'; }, g => { g.owner.sessionFile = 'foreign'; },
    g => { g.proofFails = true; }, g => { g.open = true; },
    g => g.records.push({ kind: 'verified', sourcePath: g.p.sourcePath }),
    g => { g.records[0].draft.acceptance[0] = 'tampered'; }]) {
    const g = commandFixture(), draft = (await g.propose()).details;
    g.ctx.ui.confirm = async () => { mutate(g); return true; };
    await g.accept(draft.draftId);
    assert.equal(g.records.some(r => r.kind === 'acceptance-scope'), false, g.notices.join('; '));
  }
  const g = commandFixture();
  g.records.push({ kind: 'verification-handoff', sourcePath: g.p.sourcePath, handoffId: 'used' },
    { kind: 'integration-validation', handoffId: 'used' });
  await assert.rejects(g.propose(), /after accepted/);
  const h = commandFixture(); h.records.push({ kind: 'planned', sourcePath: h.p.sourcePath, root: '/foreign' });
  await assert.rejects(h.propose(), /ownership differs/);
});
