import { isDeepStrictEqual } from 'node:util';
import { collectVerificationEvidence, renderVerificationDraft } from './verification-handoff.js';

const ENTRY = 'forgeflow-adapter';
const ref = entry => ({ entryId: entry?.id ?? null, recordedAt: entry?.data?.recordedAt ?? entry?.data?.verifiedAt ?? entry?.timestamp ?? null });
const errorText = error => error instanceof Error ? error.message : String(error);

// Historical inspection only. No brief, filesystem, manifest, native probes,
// confirmation UI or saver is consulted. Missing records cannot prove no effect.
export function verificationAudit(entries, { workflowId, current = {} } = {}) {
  const custom = entries.flatMap((entry, index) => entry?.type === 'custom' && entry.customType === ENTRY && entry.data && typeof entry.data === 'object'
    ? [{ ...entry, index }] : []);
  const records = custom.map(entry => entry.data);
  const candidate = custom.findLast(entry => ['verified', 'verification-handoff', 'verification-draft'].includes(entry.data.kind) && entry.data.workflowId);
  workflowId ??= candidate?.data.workflowId ?? null;
  const selected = custom.filter(entry => entry.data.workflowId === workflowId && ['verified', 'verification-handoff', 'verification-draft'].includes(entry.data.kind));
  const saved = selected.filter(entry => entry.data.kind === 'verified');
  const ids = [...new Set(selected.filter(entry => ['verification-handoff', 'verification-draft', 'verified'].includes(entry.data.kind))
    .map(entry => entry.data.handoffId).filter(id => typeof id === 'string' && id))];
  const handoffs = ids.map(handoffId => {
    const children = custom.filter(entry => entry.data.handoffId === handoffId);
    const intents = children.filter(entry => entry.data.kind === 'verification-handoff');
    const intent = intents.length === 1 ? intents[0] : null;
    const gaps = [];
    if (!intent) gaps.push('Missing or duplicate handoff record in this session branch.');
    if (intent && intent.data.workflowId !== workflowId) gaps.push('Handoff belongs to another workflow.');
    const drafts = children.filter(entry => entry.data.kind === 'verification-draft');
    const decisions = children.filter(entry => entry.data.kind === 'verification-review-decision');
    const attempts = children.filter(entry => entry.data.kind === 'verification-save-attempt');
    const cancellations = children.filter(entry => entry.data.kind === 'verification-cancelled');
    const verifications = saved.filter(entry => entry.data.handoffId === handoffId);
    let actual = [], evidenceError = null;
    if (intent) {
      try { actual = collectVerificationEvidence(intent.data, records, entries); }
      catch (error) { evidenceError = errorText(error); gaps.push(evidenceError); }
    }
    if (new Set(actual.map(item => item.toolCallId)).size !== actual.length) gaps.push('Duplicate validation tool-call audit records.');
    const draftReports = drafts.map(entry => {
      const draft = entry.data, problems = [];
      if (!draft.draftId || drafts.filter(item => item.data.draftId === draft.draftId).length !== 1) problems.push('Missing or duplicate draft ID.');
      if (!intent || entry.index <= intent.index || draft.workflowId !== workflowId || draft.commit !== intent.data.commit || draft.fingerprint !== intent.data.fingerprint)
        problems.push('Draft does not match the preceding handoff workflow, commit or fingerprint.');
      if (evidenceError || !intent || !isDeepStrictEqual(draft.evidence, actual)) problems.push('Draft evidence does not match available native tool evidence.');
      const assessments = Array.isArray(draft.assessments) ? draft.assessments : [];
      const requirements = Array.isArray(intent?.data.requirements) ? intent.data.requirements : [];
      if (!requirements.length || requirements.some(item => !item || typeof item.id !== 'string') ||
          new Set(requirements.map(item => item?.id)).size !== requirements.length ||
          new Set(assessments.map(item => item?.id)).size !== assessments.length || assessments.length !== requirements.length || requirements.some(requirement => {
        const matches = assessments.filter(item => item?.id === requirement.id);
        return matches.length !== 1 || matches[0].instruction !== requirement.instruction;
      })) problems.push('Draft requirement assessments are missing, duplicated or changed.');
      if (assessments.some(item => !item || !['pass', 'fail', 'blocked'].includes(item.outcome) ||
          typeof item.summary !== 'string' || !item.summary.trim() || !Array.isArray(item.toolCallIds) ||
          (item.outcome !== 'blocked' && !item.toolCallIds.length) || new Set(item.toolCallIds).size !== item.toolCallIds.length ||
          item.toolCallIds.some(id => !actual.some(e => e.toolCallId === id) || (item.outcome === 'pass' && actual.find(e => e.toolCallId === id)?.isError))))
        problems.push('Draft has invalid assessments or unsupported tool references.');
      const eligible = assessments.length > 0 && assessments.every(item => item?.outcome === 'pass') && actual.every(item => !item.isError);
      if (draft.eligible !== eligible) problems.push('Recorded draft eligibility disagrees with its evidence/assessments.');
      return { ...ref(entry), draftId: draft.draftId ?? null, eligible: draft.eligible === true,
        assessments: assessments.map(item => ({ requirementId: item?.id, outcome: item?.outcome, toolCallIds: item?.toolCallIds })), gaps: problems };
    });
    for (const draft of draftReports) gaps.push(...draft.gaps.map(problem => `Draft ${draft.draftId}: ${problem}`));
    for (const entry of [...decisions, ...attempts]) {
      const matching = drafts.filter(draft => draft.data.draftId === entry.data.draftId && draft.index < entry.index);
      if (matching.length !== 1) gaps.push(`${entry.data.kind} has no unique preceding draft.`);
    }
    if (decisions.some(entry => !['confirmed', 'declined'].includes(entry.data.decision))) gaps.push('Unrecognized review decision.');
    const saveReports = verifications.map(entry => {
      const verification = entry.data, matching = attempts.filter(attempt => attempt.data.draftId === verification.verificationDraftId && attempt.index < entry.index);
      const draft = drafts.filter(item => item.data.draftId === verification.verificationDraftId);
      const problems = [];
      if (matching.length !== 1) problems.push('Saved verification has no unique preceding save attempt.');
      if (draft.length !== 1 || !draft[0].data.eligible || draft[0].data.commit !== verification.commit || verification.commit !== intent?.data.commit)
        problems.push('Saved verification does not match an eligible handoff draft/commit.');
      if (draft.length === 1) {
        try {
          if (verification.evidence !== `User-reviewed root validation draft ${draft[0].data.draftId}.\n${renderVerificationDraft(draft[0].data)}`)
            problems.push('Saved verification evidence differs from the reviewed draft.');
        } catch { problems.push('Reviewed draft cannot be rendered from the available records.'); }
      }
      const attempt = matching.length === 1 ? matching[0] : null;
      const decision = attempt && decisions.findLast(item => item.index < attempt.index && item.data.draftId === verification.verificationDraftId);
      if (decision && decision.data.decision !== 'confirmed') problems.push('Save attempt follows a declined review without a recorded confirmation.');
      if (cancellations.some(item => item.index < entry.index)) problems.push('Saved verification follows a cancelled handoff.');
      if (verification.verificationMethod && verification.verificationMethod !== 'handoff') problems.push('Verification method conflicts with handoff provenance.');
      if (intent && ['root', 'sessionFile', 'paneId', 'workspaceId'].some(key => verification[key] !== undefined && verification[key] !== intent.data.current?.[key]))
        problems.push('Saved verification owner differs from the handoff owner.');
      return { ...ref(entry), commit: verification.commit, draftId: verification.verificationDraftId ?? null,
        confirmation: decision?.data.decision === 'confirmed' ? 'recorded-confirmation' : attempt && !decision ? 'inferred-from-legacy-save-attempt' : 'not-established', gaps: problems };
    });
    for (const save of saveReports) gaps.push(...save.gaps);
    if (attempts.length > 1) gaps.push('Multiple save attempts; inspect before any retry.');
    if (verifications.length > 1) gaps.push('Multiple verification records for this handoff.');
    if (children.some(entry => entry.data.workflowId && entry.data.workflowId !== workflowId)) gaps.push('Conflicting workflow references share this handoff ID.');
    const owner = intent?.data.current ?? null;
    const contextMatches = owner && ['root', 'sessionFile', 'paneId', 'workspaceId'].every(key => owner[key] && owner[key] === current[key]);
    return { handoffId, ...ref(intent), owner, context: contextMatches ? 'recorded-context-matches' : 'different-or-unestablished-context',
      commit: intent?.data.commit ?? null, taskId: intent?.data.taskId ?? null,
      state: gaps.length ? 'evidence-gaps' : verifications.length ? 'saved' : attempts.length ? 'save-unresolved' : cancellations.length ? 'cancelled' : drafts.length ? 'draft-awaiting-save' : 'validation-unfinished',
      drafts: draftReports, decisions: decisions.map(entry => ({ ...ref(entry), draftId: entry.data.draftId, decision: entry.data.decision })),
      saveAttempts: attempts.map(entry => ({ ...ref(entry), draftId: entry.data.draftId })), saves: saveReports,
      cancellations: cancellations.map(ref),
      toolEvidence: actual.map(({ toolCallId, toolName, resultEntryId, resultSha256, isError }) => ({ toolCallId, toolName, resultEntryId, resultSha256, isError })), gaps };
  });
  const verifications = saved.map(entry => {
    const value = entry.data, linked = Boolean(value.handoffId || value.verificationDraftId);
    return { ...ref(entry), commit: value.commit, method: linked ? 'handoff' : value.verificationMethod === 'direct' ? 'direct' : 'legacy-unattributed',
      handoffId: value.handoffId ?? null, draftId: value.verificationDraftId ?? null,
      gaps: linked && (!value.handoffId || !value.verificationDraftId) ? ['Incomplete handoff/draft provenance.'] :
        !linked && value.verificationMethod === 'handoff' ? ['Handoff method recorded without provenance IDs.'] : [] };
  });
  const orphaned = selected.filter(entry => entry.data.kind === 'verification-draft' && !entry.data.handoffId).map(ref);
  return { mode: 'read-only-verification-audit', workflowId, current, handoffs, verifications, orphaned,
    warnings: [
      'Current session branch only. Historical records and output hashes do not attest current code correctness, authorization or live readiness.',
      'No tests rerun, native probes, confirmation, verification save, retry or workflow mutation performed.',
      'Missing or incomplete records leave outcomes unresolved; they authorize no retry.',
      ...(!selected.length ? ['No matching records in this branch; this does not prove the workflow was never verified.'] : []),
      ...(orphaned.length ? ['Draft records without handoff IDs cannot establish provenance.'] : []),
    ] };
}

export function renderVerificationAudit(report) {
  return [`Verification audit: ${report.workflowId ?? 'no recorded workflow'}`, ...report.warnings,
    ...report.verifications.map(record => `Verification ${record.entryId ?? '(entry ID unavailable)'}: ${record.method} | ${record.commit ?? 'unknown commit'} | ${record.recordedAt ?? 'time unavailable'}\nHandoff: ${record.handoffId ?? 'none'} | Draft: ${record.draftId ?? 'none'}${record.gaps.length ? `\nGaps: ${record.gaps.join(' ')}` : ''}`),
    ...report.handoffs.flatMap(item => [
      `Handoff ${item.handoffId}: ${item.state}\nOwner: ${JSON.stringify(item.owner)} | ${item.context}\nTask: ${item.taskId ?? '?'} | Commit: ${item.commit ?? '?'}`,
      ...item.drafts.map(draft => `Draft ${draft.draftId}: eligible=${draft.eligible}; entry ${draft.entryId ?? '?'}\n${draft.assessments.map(a => `${a.requirementId}: ${a.outcome}; tools=${Array.isArray(a.toolCallIds) ? a.toolCallIds.join(', ') : 'unavailable'}`).join('\n')}`),
      ...item.decisions.map(decision => `Review ${decision.decision}: draft ${decision.draftId}; entry ${decision.entryId ?? '?'}; ${decision.recordedAt ?? 'time unavailable'}`),
      ...item.saveAttempts.map(attempt => `Save attempt: draft ${attempt.draftId}; entry ${attempt.entryId ?? '?'}; ${attempt.recordedAt ?? 'time unavailable'}`),
      ...item.saves.map(save => `Saved: entry ${save.entryId ?? '?'}; confirmation=${save.confirmation}`),
      ...item.toolEvidence.map(e => `Tool ${e.toolCallId} (${e.toolName}): result ${e.resultEntryId}; SHA-256 ${e.resultSha256}; error/unknown=${e.isError}`),
      ...item.gaps.map(gap => `Gap: ${gap}`),
      ...(item.state === 'save-unresolved' ? ['Save attempt has no matching verification record here. Outcome unresolved; no retry authorized.'] : []),
    ])].join('\n\n');
}

export function registerVerificationAudit(pi) {
  const inspect = (params, ctx) => {
    if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).some(key => key !== 'workflowId') || (params.workflowId !== undefined && (typeof params.workflowId !== 'string' || !/^herdr-[a-z0-9-]+$/.test(params.workflowId))))
      throw new Error('Usage: verification audit accepts only an optional workflowId (herdr-...)');
    return verificationAudit(ctx.sessionManager?.getBranch?.() ?? [], { ...params, current: {
      root: ctx.cwd, sessionFile: ctx.sessionManager?.getSessionFile?.() ?? null,
      paneId: process.env.HERDR_PANE_ID ?? null, workspaceId: process.env.HERDR_WORKSPACE_ID ?? null,
    } });
  };
  pi.registerTool({ name: 'forgeflow_verification_audit', label: 'Inspect verification history',
    description: 'Read-only current-session verification audit: handoffs, drafts, actual tool-result references, review decisions, save attempts and verification records. Optional workflowId; defaults to latest verification/handoff workflow. Does not rerun validation, inspect other sessions, confirm, save, retry or invoke native tools.',
    parameters: { type: 'object', properties: { workflowId: { type: 'string', pattern: '^herdr-[a-z0-9-]+$' } }, additionalProperties: false },
    execute: async (_id, params, _signal, _update, ctx) => {
      const report = inspect(params, ctx);
      return { content: [{ type: 'text', text: renderVerificationAudit(report) }], details: report };
    },
  });
  pi.registerCommand('forgeflow-verification-audit', {
    description: 'Inspect verification history for a workflow (or latest); no execution or records changed',
    handler: async (args, ctx) => {
      try {
        const report = inspect(args.trim() ? { workflowId: args.trim() } : {}, ctx);
        pi.sendMessage({ customType: 'forgeflow-verification-audit', display: true, content: renderVerificationAudit(report), details: report }, { triggerTurn: false });
      } catch (error) { ctx.ui.notify(errorText(error), 'error'); }
    },
  });
}
