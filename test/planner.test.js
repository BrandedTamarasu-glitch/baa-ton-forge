import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPreview, parseBrief, renderPreview } from '../planner.js';
import adapter from '../extension.js';

const task = (id, files, extra = {}) => ({ id, objective: `Implement ${id}`, files, checks: ['node --test'], ...extra });
const brief = tasks => ({ version: 1, objective: 'Improve project', acceptance: ['Existing behavior remains covered'], tasks });

test('disjoint writers run in parallel and reviews follow all writers', () => {
  const result = buildPreview(brief([task('api', ['src/api/'], { worktreeCwd: '/tmp/api' }), task('ui', ['src/ui/'], { worktreeCwd: '/tmp/ui' }), task('review', ['src/'], { readOnly: true })]));
  assert.deepEqual(result.stages, [['api', 'ui'], ['review']]);
  assert.equal(result.workflows.length, 3);
  for (const workflow of result.workflows) {
    assert.equal(workflow.planArguments.lanes.length, 1);
    assert.equal('dependencies' in workflow.planArguments.lanes[0], false);
    assert.equal('files' in workflow.planArguments.lanes[0], false);
    assert.match(workflow.planArguments.lanes[0].objective, /Acceptance criteria/);
    assert.ok(workflow.blockers.length > 0);
  }
});

test('directory ownership conflicts serialize writers, respecting explicit reverse ordering', () => {
  const result = buildPreview(brief([task('first', ['src/'], { dependsOn: ['second'] }), task('second', ['src/a.js'])]));
  assert.deepEqual(result.stages, [['second'], ['first']]);
  assert.deepEqual(result.conflicts[0], { before: 'second', after: 'first', scopes: [['src/a.js', 'src/']] });
});

test('rejects dependency cycles and reviewers that writers depend on', () => {
  assert.throws(() => buildPreview(brief([task('a', ['a'], { dependsOn: ['b'] }), task('b', ['b'], { dependsOn: ['a'] })])), /cycle/);
  assert.throws(() => buildPreview(brief([task('a', ['a'], { dependsOn: ['review'] }), task('review', ['a'], { readOnly: true })])), /cycle/);
});

test('rejects ambiguous scopes, malformed fields and shared writer worktrees', () => {
  for (const scope of ['../escape', '/absolute', 'src/../escape', 'src//x', 'src/*.js', '.git/config', 'C:\\file']) {
    assert.throws(() => buildPreview(brief([task('a', [scope])])));
  }
  assert.throws(() => buildPreview(brief([task('a', ['a'], { readOnly: 'false' })])), /boolean/);
  assert.throws(() => buildPreview(brief([task('a', ['a'], { dependsOn: ['missing'] })])), /dependency/);
  assert.throws(() => buildPreview(brief([task('a', ['a']), task('a', ['b'])])), /unique/);
  assert.throws(() => buildPreview(brief([task('a', ['a'], { worktreeCwd: '/tmp/work' }), task('b', ['b'], { worktreeCwd: '/tmp/work/.' })])), /distinct/);
  assert.throws(() => buildPreview({ ...brief([task('a', ['a'])]), authorizationPolicy: {} }), /unknown field/);
});

test('Markdown requires exactly one explicit block and profiles are preserved without inferred models', () => {
  const profile = { provider: 'openai-codex', model: 'chosen-model', thinking: 'high', auth: 'subscription' };
  const input = brief([task('a', ['a'], { launchProfile: profile, worktreeCwd: '/tmp/a' })]);
  const md = '# Implementation brief\n\n```forgeflow-lanes\n' + JSON.stringify(input) + '\n```\n';
  assert.deepEqual(parseBrief(md), input);
  assert.throws(() => parseBrief(md + md), /exactly one/);
  assert.throws(() => parseBrief('# Just prose'), /exactly one/);
  const result = buildPreview(input);
  assert.deepEqual(result.workflows[0].planArguments.lanes[0].launchProfile, profile);
  assert.equal(result.workflows[0].planArguments.worktreeCwd, '/tmp/a');
  assert.equal('launchProfile' in buildPreview(brief([task('b', ['b'], { readOnly: true })])).workflows[0].planArguments.lanes[0], false);
});

test('Pi command handles paths with spaces and only displays a preview without a model turn', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'forge adapter '));
  try {
    await writeFile(path.join(dir, 'my brief.json'), JSON.stringify(brief([task('a', ['a'])])));
    let command;
    const messages = [], errors = [];
    adapter({ appendEntry() {}, registerCommand(name, definition) { if (name === 'forgeflow-plan-lanes') command = definition; }, sendMessage(...args) { messages.push(args); } });
    const ctx = { cwd: dir, ui: { notify: (...args) => errors.push(args) } };
    await command.handler('"my brief.json"', ctx);
    assert.equal(errors.length, 0);
    assert.equal(messages.length, 1);
    adapter({ appendEntry() {}, registerCommand(name, definition) { if (name === 'forgeflow-plan-lanes') command = definition; }, sendMessage() { throw 'message delivery failed'; } });
    await command.handler('my brief.json', ctx);
    assert.deepEqual(errors.at(-1), ['message delivery failed', 'error']);
    assert.deepEqual(messages[0][1], { triggerTurn: false });
    assert.equal(messages[0][0].details.sourceSha256.length, 64);
    await command.handler('missing.json', ctx);
    assert.equal(errors.length, 2);
    assert.equal(messages.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unbound writers have no pasteable tool arguments; read-only lanes can use root cwd', () => {
  const result = buildPreview(brief([task('writer', ['src/'])]));
  assert.equal(result.workflows[0].planArguments, null);
  assert.match(renderPreview(result), /arguments withheld/);
  assert.doesNotMatch(renderPreview(result), /```json/);
  const review = buildPreview(brief([task('review', ['src/'], { readOnly: true })])).workflows[0];
  assert.equal(review.planArguments.lanes[0].readOnly, true);
  assert.equal('worktreeCwd' in review.planArguments, false);
  assert.equal(review.blockers.some(message => message.includes('Assign a clean')), false);
});

test('recognized but unqualified harnesses are rejected with the qualification reason', () => {
  assert.throws(() => buildPreview(brief([task('a', ['a'], { agentKind: 'gemini' })])), /no qualified launch adapter/);
});
