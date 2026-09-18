import test from 'node:test';
import assert from 'node:assert/strict';
import { continuationPreview, renderContinuation } from '../continuation.js';

function fixture(code, category) {
  const nextAction = { code, category, label: code, reason: 'Evidence requires this step', suggestedTool: null };
  const task = { taskId: 'task', workflowId: 'herdr-existing', owner: { sessionFile: 'owner' }, nextAction,
    blockers: [], pendingQuestions: [], pendingApprovals: [] };
  return { sourcePath: '/brief.json', sourceSha256: 'snapshot', current: { root: '/project', sessionFile: 'owner', paneId: 'p', workspaceId: 'w' },
    warnings: [], tasks: [task], nextAction: { taskId: task.taskId, ...nextAction } };
}

test('continuation proposes only one step and retains execution/authorization boundaries', () => {
  for (const [code, category] of [
    ['preview', 'ready-for-root'], ['prepare', 'ready-for-root'], ['plan', 'ready-for-root'],
    ['review-dispatch', 'ready-for-root'], ['verify-completion', 'awaiting-verification'],
    ['observe-workflow', 'waiting'], ['resume-owning-root', 'blocked'],
    ['inspect-submission', 'blocked'], ['wait-dependencies', 'blocked'],
    ['review-approval', 'awaiting-approval'], ['answer-question', 'awaiting-answer'],
  ]) {
    const status = fixture(code, category);
    const before = structuredClone(status);
    const report = continuationPreview(status);
    assert.equal(report.proposedStep.code, code);
    assert.equal(report.proposedStep.category, category);
    assert.equal(report.proposedStep.workflowId, 'herdr-existing');
    assert.equal(report.executionSupported, false);
    assert.equal(report.executed, false);
    assert.equal(report.authorization, 'not-assessed');
    assert.equal(report.nativeReadiness, 'not-checked');
    assert.ok(report.proposedStep.requiredChecks.length);
    assert.equal(report.proposedStep.arguments, undefined);
    assert.match(report.stopReason, /No suggested operation was invoked/);
    assert.deepEqual(status, before);
    assert.match(renderContinuation(report), /execution is not supported/);
  }
  const prepare = continuationPreview(fixture('prepare', 'ready-for-root'));
  assert.match(prepare.proposedStep.requiredChecks.join(' '), /createSourceWorkspace=false/);
  const verify = continuationPreview(fixture('verify-completion', 'awaiting-verification'));
  assert.match(verify.proposedStep.requiredChecks.join(' '), /claim, not verification/);
});

test('other blockers and requests remain visible when an independent step is selected', () => {
  const status = fixture('preview', 'ready-for-root');
  const blocked = fixture('review-approval', 'awaiting-approval').tasks[0];
  blocked.taskId = 'other';
  blocked.blockers = ['Unresolved prerequisite'];
  blocked.pendingApprovals = [{ id: 'approval-1', action: 'dispatch', request: 'Approve launch?' }];
  blocked.pendingQuestions = [{ id: 'question-1', question: 'Which target?' }];
  status.tasks.push(blocked);
  status.warnings.push('Historical snapshot');
  const rendered = renderContinuation(continuationPreview(status));
  assert.match(rendered, /Approval approval-1 \(dispatch\): Approve launch\?/);
  assert.match(rendered, /Question question-1: Which target\?/);
  assert.match(rendered, /Blocked: Unresolved prerequisite/);
  assert.match(rendered, /Warning: Historical snapshot/);
});

test('complete and unfamiliar advice never produce an execution path', () => {
  const status = fixture('none', 'complete');
  status.nextAction = null;
  const complete = continuationPreview(status);
  assert.equal(complete.proposedStep, null);
  assert.match(complete.stopReason, /historical/);
  const unknown = continuationPreview(fixture('future-code', 'blocked'));
  assert.equal(unknown.executed, false);
  assert.deepEqual(unknown.proposedStep.requiredChecks, ['Evidence requires this step']);
});
