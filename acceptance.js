import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const acceptanceHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const acceptanceScopesSchema = { type: 'array', minItems: 1, items: {
  type: 'object', properties: { requirementId: { type: 'string', pattern: '^acceptance-[1-9][0-9]*$' },
    taskIds: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } },
    phase: { type: 'string', enum: ['pre-integration', 'final'] } },
  required: ['requirementId', 'taskIds', 'phase'], additionalProperties: false,
} };

// Scope changes WHEN and WHICH TASK must assess text, never the text or outcome.
// Pre-integration requirements are cumulative: they must pass again at final verification.
export function normalizeAcceptanceScopes(acceptance, taskIds, scopes) {
  if (!Array.isArray(scopes) || scopes.length !== acceptance.length)
    throw new Error('Assign every acceptance criterion exactly once');
  const ids = acceptance.map((_, i) => `acceptance-${i + 1}`);
  if (scopes.some(item => !item || typeof item !== 'object' || Array.isArray(item) ||
      Object.keys(item).some(key => !['requirementId', 'taskIds', 'phase'].includes(key)) ||
      !ids.includes(item.requirementId)) || new Set(scopes.map(item => item.requirementId)).size !== ids.length)
    throw new Error('Acceptance scopes require unique original acceptance IDs; scope and checks cannot be deferred');
  return ids.map(requirementId => {
    const item = scopes.find(scope => scope.requirementId === requirementId);
    if (!['pre-integration', 'final'].includes(item.phase) || !Array.isArray(item.taskIds) || !item.taskIds.length ||
        item.taskIds.some(id => !taskIds.includes(id)) || new Set(item.taskIds).size !== item.taskIds.length)
      throw new Error(`${requirementId}: select existing tasks and a pre-integration or final phase`);
    return { requirementId, taskIds: [...item.taskIds].sort(), phase: item.phase };
  });
}

export function acceptanceScopeDraft(preview, current, scopes) {
  const draft = { sourcePath: preview.sourcePath, sourceSha256: preview.sourceSha256, current,
    acceptance: preview.acceptance, scopes: normalizeAcceptanceScopes(preview.acceptance,
      preview.workflows.map(task => task.taskId), scopes) };
  return { ...draft, draftId: acceptanceHash(draft) };
}

export function scopedAcceptance(preview, { taskId, beforeIntegration = false, records = [], current }) {
  const saved = records.filter(item => item.kind === 'acceptance-scope' && item.sourcePath === preview.sourcePath);
  let scopes = preview.acceptanceScopes, source = 'brief', draftId = null;
  if (saved.length) {
    if (scopes || saved.length !== 1) throw new Error('Conflicting acceptance scopes; inspect the owning session');
    const record = saved[0];
    const expected = acceptanceScopeDraft(preview, current, record.scopes);
    const drafts = records.filter(item => item.kind === 'acceptance-scope-draft' && item.draft?.draftId === record.draftId);
    const { kind, recordedAt, ...actual } = record;
    if (!isDeepStrictEqual(actual, expected) || drafts.length !== 1 || !isDeepStrictEqual(drafts[0].draft, expected))
      throw new Error('Acceptance scope provenance, brief or owning context changed; no criteria may be omitted');
    scopes = expected.scopes; source = 'session'; draftId = record.draftId;
  }
  if (!scopes) return {};
  scopes = normalizeAcceptanceScopes(preview.acceptance, preview.workflows.map(task => task.taskId), scopes);
  const phase = beforeIntegration ? 'pre-integration' : 'final';
  const applicableAcceptance = [], deferredAcceptance = [];
  for (const [index, scope] of scopes.entries()) {
    const requirement = { id: scope.requirementId, instruction: preview.acceptance[index] };
    if (scope.taskIds.includes(taskId) && (!beforeIntegration || scope.phase === 'pre-integration'))
      applicableAcceptance.push(requirement);
    else deferredAcceptance.push({ ...requirement, taskIds: scope.taskIds, phase: scope.phase,
      reason: scope.taskIds.includes(taskId) ? 'later-phase' : 'other-task' });
  }
  return { acceptanceScope: { source, draftId, phase, scopes }, applicableAcceptance, deferredAcceptance };
}

export function requiresScopedHandoff(preview, records) {
  return Boolean(preview.acceptanceScopes || records.some(item => item.kind === 'acceptance-scope' && item.sourcePath === preview.sourcePath));
}
