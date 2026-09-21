// Projection of status evidence only: never execute the suggested operation.
const gates = {
  preview: ['Save a fresh brief preview in the owning Pi session before preparation.'],
  prepare: ['Confirm authority for preparation and any source-workspace creation; use createSourceWorkspace=false when creation is not authorized.', 'Native preparation must validate ownership, clean checkout, dependencies and source binding.'],
  plan: ['Use the exact saved prepared arguments under existing user authorization.', 'The native submission guard must recheck preparation, ownership and source readiness.'],
  'review-dispatch': ['Recheck current user authorization, checkout, dependency integration and native Baa-ton readiness.', 'Only Baa-ton may dispatch the existing workflow; do not create a replacement.'],
  'verify-completion': ['Independently inspect the scoped diff and rerun required validation.', 'Confirm required integration and its authorization before recording native root verification.', 'A durable receipt is a claim, not verification; pending notification delivery does not require redispatch.'],
};

export function continuationPreview(status) {
  const selected = status.nextAction;
  const task = selected && status.tasks.find(item => item.taskId === selected.taskId);
  return {
    mode: 'continuation-preview', executionSupported: false, executed: false,
    authorization: 'not-assessed', nativeReadiness: 'not-checked',
    sourcePath: status.sourcePath, sourceSha256: status.sourceSha256, current: status.current,
    proposedStep: task ? {
      taskId: task.taskId, workflowId: task.workflowId, owner: task.owner,
      ...task.nextAction,
      requiredChecks: gates[task.nextAction.code] ?? [task.nextAction.reason],
    } : null,
    stopReason: task
      ? `Preview only. ${task.nextAction.reason} No suggested operation was invoked; obtain fresh evidence before taking any step.`
      : 'No further lane action is suggested by the saved evidence. Verification remains historical; no cleanup, push or merge is implied.',
    // Keep every task visible: selecting one does not clear other blockers or requests.
    tasks: status.tasks, warnings: status.warnings,
  };
}

export function renderContinuation(report) {
  const step = report.proposedStep;
  return [
    'Continuation preview only — execution is not supported.',
    `Brief: ${report.sourcePath}`,
    `Snapshot: ${report.sourceSha256}`,
    `Root: ${report.current.root} | Pane: ${report.current.paneId ?? '?'} | Workspace: ${report.current.workspaceId ?? '?'}`,
    `Session: ${report.current.sessionFile ?? 'unknown'}`,
    report.readiness ? `Prerequisites: ${report.readiness.state}. Authorization and runtime qualification not assessed. Read-only inspection; no workflow writes or dispatch.` : 'Authorization not assessed; native readiness not checked. No native tools, workflow writes or model turns initiated.',
    ...(report.readiness?.checks ?? []).map(check => `Checked: ${check}`),
    ...(report.readiness?.blockers ?? []).map(blocker => `Readiness blocker: ${blocker}`),
    ...report.warnings.map(warning => `Warning: ${warning}`),
    ...(step ? [
      `Proposed next: ${step.taskId} — ${step.label} [${step.category}]`,
      `Workflow: ${step.workflowId ?? 'unmapped'}`,
      `Owner session: ${step.owner?.sessionFile ?? 'not established'}`,
      ...step.requiredChecks.map(check => `Required: ${check}`),
      ...(step.suggestedTool === 'forgeflow_diagnose_lane' ? [`Read-only diagnosis tool: forgeflow_diagnose_lane ${JSON.stringify({ filename: report.sourcePath, taskId: step.taskId })}`] : []),
    ] : ['Proposed next: none']),
    `Stop: ${report.stopReason}`,
    ...report.tasks.flatMap(task => [
      `${task.taskId}: ${task.nextAction.category} — ${task.nextAction.label}`,
      ...task.blockers.map(blocker => `Blocked: ${blocker}`),
      ...task.pendingQuestions.map(item => `Question ${item.id}: ${item.question ?? 'inspect the saved request'}`),
      ...task.pendingApprovals.map(item => `Approval ${item.id} (${item.action}): ${item.request ?? 'inspect the saved request'}`),
    ]),
  ].join('\n');
}
