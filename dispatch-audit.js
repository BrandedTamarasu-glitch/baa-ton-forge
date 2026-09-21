// Select only the requested workflow's history. Never fall back to a newer probe.
export function selectDispatchAudit(records, workflowId = null, scope = null) {
  const intents = records.filter(item => item.kind === 'dispatch-intent' &&
    (!workflowId || item.workflowId === workflowId));
  const selected = workflowId ? intents : intents.slice(-1);
  const keys = ['taskId', 'sourcePath', 'sourceSha256', 'root', 'sessionFile', 'paneId', 'workspaceId'];
  const conflicts = [];
  const attempts = selected.map(intent => {
    const entries = records.filter(item => item.intentId === intent.intentId);
    if (!intent.intentId || records.filter(item => item.kind === 'dispatch-intent' && item.intentId === intent.intentId).length !== 1)
      conflicts.push('Dispatch intent identity is missing or duplicated.');
    if (scope && keys.some(key => intent[key] !== scope[key])) conflicts.push('Dispatch intent belongs to another brief, task or owner.');
    if (entries.some(item => item.workflowId !== undefined && item.workflowId !== intent.workflowId ||
      keys.some(key => item[key] !== undefined && item[key] !== intent[key]))) conflicts.push('Dispatch audit contains conflicting ownership.');
    const calls = entries.filter(item => item.kind === 'dispatch-attempt');
    const results = entries.filter(item => item.kind === 'dispatch-result');
    if (calls.length > 1 || results.length > 1 || results.length &&
      (calls.length !== 1 || !calls[0].toolCallId || calls[0].toolCallId !== results[0].toolCallId))
      conflicts.push('Dispatch call/result evidence is missing, duplicated or mismatched.');
    return { intent, entries, calls, results };
  });
  if (workflowId && records.some(item => item.workflowId === workflowId &&
    ['dispatch-attempt', 'dispatch-result', 'dispatch-blocked'].includes(item.kind) &&
    !selected.some(intent => intent.intentId === item.intentId))) conflicts.push('Dispatch audit contains an orphaned attempt or result.');
  return { workflowId: workflowId ?? selected[0]?.workflowId ?? null, attempts, conflicts: [...new Set(conflicts)],
    audit: attempts.flatMap(item => item.entries) };
}
