import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { loadPreview } from './planner.js';
import { identity } from './prepare.js';
import { acceptanceScopeDraft, acceptanceScopesSchema } from './acceptance.js';
import { isDeepStrictEqual } from 'node:util';

export function renderAcceptanceScope(draft) {
  return [`Acceptance scope draft: ${draft.draftId}`, `Brief: ${draft.sourcePath}`, `Snapshot: ${draft.sourceSha256}`,
    'Changes requirement timing and task responsibility only. No acceptance passed, verification saved or integration authorized.',
    ...draft.scopes.map((scope, i) => `${scope.requirementId}: ${draft.acceptance[i]}\nRequired for: ${scope.taskIds.join(', ')} | ${scope.phase === 'pre-integration' ? 'pre-integration AND final verification' : 'final verification'}`),
    'All scope inspections and declared checks remain required. Other-task and later-phase criteria remain visible and pending.',
    'Existing drafts and receipts stay historical. New validation must collect fresh evidence. This scope cannot be replaced after acceptance.',
  ].join('\n\n');
}

export function registerAcceptanceScope(pi, records, { proveRoot, assertIdleHandoff, inspectBrief = loadPreview }) {
  let busy = false;
  function unused(preview, history) {
    if (preview.acceptanceScopes) throw new Error('This brief already declares acceptance scopes; no session override is allowed');
    if (history.some(item => item.kind === 'acceptance-scope' && item.sourcePath === preview.sourcePath))
      throw new Error('Acceptance scope is already confirmed and immutable');
    const intents = history.filter(item => item.kind === 'verification-handoff' && item.sourcePath === preview.sourcePath);
    if (history.some(item => (item.kind === 'verified' && item.sourcePath === preview.sourcePath) ||
        (item.kind === 'integration-validation' && intents.some(intent => intent.handoffId === item.handoffId)) ||
        (item.kind === 'integration-intent' && item.sourcePath === preview.sourcePath)))
      throw new Error('Acceptance cannot be rescoped after accepted validation, verification or an integration attempt');
  }
  async function inspect(filename, scopes, ctx) {
    assertIdleHandoff(ctx);
    const root = await realpath(ctx.cwd), sessionFile = ctx.sessionManager.getSessionFile(), pane = identity();
    if (!sessionFile || !pane.paneId || !pane.workspaceId) throw new Error('Persistent owning root identity is required');
    await proveRoot(ctx);
    const preview = await inspectBrief(path.resolve(root, filename), { cwd: root });
    const history = records(ctx);
    unused(preview, history);
    const current = { root, sessionFile, ...pane, inHerdr: true };
    for (const record of history.filter(item => ['prepared', 'planning', 'planned'].includes(item.kind) && item.sourcePath === preview.sourcePath)) {
      if (record.sourceSha256 !== preview.sourceSha256 || record.root !== root || record.sessionFile !== sessionFile ||
          record.paneId !== pane.paneId || record.workspaceId !== pane.workspaceId)
        throw new Error('Saved task snapshot or ownership differs; acceptance scoping cannot recover or adopt it');
    }
    return acceptanceScopeDraft(preview, current, scopes);
  }
  pi.registerTool({ name: 'forgeflow_preview_acceptance_scope', label: 'Preview acceptance timing and tasks',
    description: 'Propose explicit timing and task responsibility for every original acceptance criterion without editing a legacy brief. Cancel any open verification handoff first. Requires native owning-root proof. Scope/check requirements cannot be deferred. Saves a proposal only; the user must accept it with /forgeflow-accept-acceptance-scope draft-id. No old draft is made eligible; no validation, verification or integration is performed.',
    parameters: { type: 'object', properties: { filename: { type: 'string', minLength: 1 }, scopes: acceptanceScopesSchema }, required: ['filename', 'scopes'], additionalProperties: false },
    execute: async (_id, params, _signal, _update, ctx) => {
      if (busy) throw new Error('Acceptance scope operation already in progress');
      busy = true;
      try {
        const draft = await inspect(params.filename, params.scopes, ctx);
        const existing = records(ctx).filter(item => item.kind === 'acceptance-scope-draft' && item.draft?.draftId === draft.draftId);
        if (existing.length > 1 || (existing.length && !isDeepStrictEqual(existing[0].draft, draft)))
          throw new Error('Conflicting acceptance scope draft history');
        if (!existing.length) pi.appendEntry('forgeflow-adapter', { kind: 'acceptance-scope-draft', draft });
        return { content: [{ type: 'text', text: renderAcceptanceScope(draft) }], details: draft };
      } finally { busy = false; }
    },
  });
  pi.registerCommand('forgeflow-accept-acceptance-scope', {
    description: 'Confirm an immutable acceptance scope in this owning session; no validation or integration',
    handler: async (args, ctx) => {
      if (busy) { ctx.ui.notify('Acceptance scope operation already in progress', 'error'); return; }
      busy = true;
      try {
        if (!ctx.hasUI || !ctx.isIdle() || typeof ctx.ui.confirm !== 'function') throw new Error('Use an idle interactive owning root with native confirmation');
        if (!/^[a-f0-9]{64}$/.test(args.trim())) throw new Error('Usage: /forgeflow-accept-acceptance-scope draft-id');
        const matches = records(ctx).filter(item => item.kind === 'acceptance-scope-draft' && item.draft?.draftId === args.trim());
        if (matches.length !== 1) throw new Error('Expected one unambiguous acceptance scope draft');
        const saved = matches[0].draft;
        const fresh = async () => {
          const draft = await inspect(saved.sourcePath, saved.scopes, ctx);
          if (!isDeepStrictEqual(draft, saved)) throw new Error('Acceptance scope draft is stale; inspect before proposing another');
          return draft;
        };
        const draft = await fresh();
        if (!await ctx.ui.confirm('Confirm acceptance timing and task responsibility?', renderAcceptanceScope(draft))) return;
        await fresh();
        pi.appendEntry('forgeflow-adapter', { kind: 'acceptance-scope', ...draft, recordedAt: new Date().toISOString() });
        ctx.ui.notify('Acceptance scope confirmed. Start a new validation handoff; old drafts remain unchanged.', 'info');
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); }
      finally { busy = false; }
    },
  });
}
