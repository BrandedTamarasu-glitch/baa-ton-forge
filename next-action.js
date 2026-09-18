// Advice from saved/local evidence only. No native calls, authorization decisions,
// or workflow mutations belong in this module.
function action(code, category, label, reason, suggestedTool = null) {
  return { code, category, label, reason, suggestedTool };
}

export function nextAction(task, facts, tasks) {
  const { current, manifestReadable, ownerMismatch, ownerIncomplete, ambiguous, mappingMismatch,
    mapped, submitted, workflow, previewCurrent, plannable, profileResolved, preparationCurrent,
    historicalSubmission } = facts;
  if (!current.inHerdr || !current.paneId || !current.workspaceId || !current.sessionFile || ownerMismatch)
    return action('resume-owning-root', 'blocked', 'Resume the owning root',
      'A matching Herdr pane, workspace and native session are required. Do not reset registrations or adopt another session’s records.');
  if (!manifestReadable || ambiguous || (mapped && !workflow) || mappingMismatch || ownerIncomplete)
    return action('inspect-ledger', 'blocked', 'Inspect ownership and durable state',
      task.blockers[0] ?? 'The manifest is unavailable or ownership cannot be established. Do not plan a replacement.', 'herdr_observe');
  if (workflow && !mapped)
    return action('reconcile-workflow', 'blocked', 'Reconcile the existing workflow',
      'A matching durable workflow exists without its adapter mapping. Reconcile in this owning session; do not redispatch.', 'forgeflow_reconcile_lane');
  if (submitted && !mapped)
    return action('inspect-submission', 'blocked', 'Investigate the unmapped submission',
      'Inspect the saved native call/result and durable ledger. Recover only with proof of no durable effect; do not retry planning blindly.');
  if (task.verification) {
    if (task.completionReceipts !== task.laneCount || !task.laneCount)
      return action('inspect-ledger', 'blocked', 'Check changed completion evidence',
        'Historical verification exists, but its durable lane receipts are missing. Investigate rather than treating the workflow as freshly verified.', 'herdr_observe');
    return action('none', 'complete', 'No further lane action',
      'Root verification is recorded for this brief snapshot. It is historical evidence, not a new test run; no cleanup or push is implied.');
  }
  if (task.laneCount > 0 && task.completionReceipts === task.laneCount)
    return action('verify-completion', 'awaiting-verification', 'Independently verify completion',
      'All durable receipts exist, regardless of notification delivery or telemetry. Review the changes, rerun checks, confirm authorized integration, then record root verification. Do not wait for another notification or redispatch.');
  if (task.pendingQuestions.length)
    return action('answer-question', 'awaiting-answer', 'Resolve the recorded parent question',
      `Unanswered question IDs: ${task.pendingQuestions.map(item => item.id).join(', ')}. Inspect their text and use the owning root’s supported response path; do not invent an answer.`);
  if (task.pendingApprovals.length)
    return action('review-approval', 'awaiting-approval', 'Review the recorded approval request',
      `Pending requests: ${task.pendingApprovals.map(item => `${item.id} (${item.action})`).join(', ')}. Status neither approves them nor establishes user authorization.`);
  if (task.pendingAnswers.length)
    return action('inspect-answer-delivery', 'blocked', 'Inspect delivery of the saved answer',
      'An answer has been recorded but delivery is unresolved. Inspect its existing delivery evidence before sending anything again.', 'herdr_observe');
  if (workflow) {
    if ((workflow.retry && workflow.retry.state !== 'dispatching') || !['planned', 'starting', 'running', 'working', 'dispatched'].includes(workflow.status))
      return action('inspect-workflow', 'blocked', 'Inspect the existing workflow',
        `Saved status is ${workflow.status ?? 'unknown'}${workflow.retry?.failedStage ? `; failure stage: ${workflow.retry.failedStage}` : ''}. ${workflow.retry?.error ?? 'Completion has not been proved by all required receipts.'} No replacement or automatic retry is recommended.`, 'herdr_observe');
    if (workflow.status === 'planned') {
      if (task.completionReceipts || workflow.retry || workflow.dispatchedAt || workflow.lanes.some(lane =>
        lane.agentStartAttemptedAt || lane.promptAttemptedAt || lane.promptedAt || lane.paneId || lane.startupIntentPath))
        return action('inspect-workflow', 'blocked', 'Inspect existing startup effects',
          'The workflow says planned but contains execution evidence. Inspect that attempt before considering dispatch.', 'herdr_observe');
      const unresolved = unresolvedDependencies(task, tasks);
      if (unresolved.length) return waitForDependencies(unresolved);
      return action('review-dispatch', 'ready-for-root', 'Check authorization and readiness before dispatch',
        'A planned workflow is mapped. The root must recheck dependency integration, checkouts, native Baa-ton readiness and existing user authorization; this snapshot does not authorize dispatch.');
    }
    return action('observe-workflow', 'waiting', 'Observe the existing workflow',
      `${task.completionReceipts}/${task.laneCount} durable receipts are saved. Inspect the current workflow before waiting for a new event; do not redispatch or start a polling loop.`, 'herdr_observe');
  }
  if (historicalSubmission)
    return action('inspect-history', 'blocked', 'Inspect the earlier brief’s workflow history',
      'This task has a submission or mapping under an older brief/profile snapshot. A new hash does not cancel that work; account for it before preparing a replacement.');
  if (!previewCurrent)
    return action('preview', 'ready-for-root', 'Preview the current brief',
      'No matching preview is saved for the current brief/profile snapshot.', 'forgeflow_plan_lanes');
  if (!plannable)
    return action('assign-worktree', 'blocked', 'Assign a clean linked worktree',
      'This task needs a pre-existing writer/repository worktree. Assign it in the brief and preview again; status creates nothing.');
  if (!profileResolved)
    return action('configure-profile', 'blocked', 'Resolve the exact launch profile',
      'Set an authorized explicit profile or configured taskProfile, then preview again. Do not substitute a provider or model.');
  const unresolved = unresolvedDependencies(task, tasks);
  if (unresolved.length) return waitForDependencies(unresolved);
  if (task.prepareCheck === 'blocked')
    return action('resolve-prerequisite', 'blocked', 'Resolve the preparation blocker',
      task.blockers.at(-1) ?? 'A local preparation prerequisite failed; inspect it before proceeding.');
  if (!preparationCurrent)
    return action('prepare', 'ready-for-root', 'Prepare the lane natively',
      'Local prerequisites passed, but a current native preparation is needed. Preparation may create a source workspace; use createSourceWorkspace=false if resource creation is not authorized.', 'forgeflow_prepare_lane');
  return action('plan', 'ready-for-root', 'Submit the exact prepared plan under existing authorization',
    'Saved preparation still matches local checkout evidence. Native ownership/source readiness will be rechecked by the submission guard; live readiness and authorization are not established by status.', 'herdr_plan');
}

function waitForDependencies(ids) {
  return action('wait-dependencies', 'blocked', 'Finish dependency verification and integration',
    `Unresolved dependencies: ${ids.join(', ')}. Completion receipts alone do not release dependencies; root verification and required integration must pass.`);
}

function unresolvedDependencies(task, tasks) {
  return task.dependencies.filter(id => {
    const dependency = tasks.find(item => item.taskId === id);
    return !dependency?.verification || dependency.blockers.length > 0;
  });
}

export function recommendedAction(tasks) {
  const priority = ['awaiting-verification', 'awaiting-answer', 'awaiting-approval', 'ready-for-root', 'waiting', 'blocked'];
  for (const category of priority) {
    const task = tasks.find(item => item.nextAction.category === category);
    if (task) return { taskId: task.taskId, ...task.nextAction };
  }
  return null;
}
