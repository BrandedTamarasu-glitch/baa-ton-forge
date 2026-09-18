import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { loadPreview } from './planner.js';
import { prepareLane } from './prepare.js';
import { submissionRecovered } from './recovery.js';
import { nextAction, recommendedAction } from './next-action.js';

const receiptPresent = lane => typeof lane.completionReceipt?.id === 'string' && lane.completionReceipt.id.trim() &&
  typeof lane.completionReceipt?.summary === 'string' && lane.completionReceipt.summary.trim();

function currentPreparation(prepared, local, current) {
  if (!prepared || !local) return false;
  const { nativeReadiness, sessionFile, ...saved } = prepared;
  const root = nativeReadiness?.root;
  return isDeepStrictEqual(saved, local) && nativeReadiness?.version === 1 &&
    sessionFile === current.sessionFile && root?.sessionFile === current.sessionFile &&
    root?.paneId === current.paneId && root?.workspaceId === current.workspaceId && root?.checkout === current.root &&
    (!local.planArguments.worktreeCwd || (typeof nativeReadiness.source?.workspaceId === 'string' && Boolean(nativeReadiness.source.workspaceId)));
}

async function sameCheckout(actual, expected) {
  if (actual === expected) return true;
  if (typeof actual !== 'string' || !path.isAbsolute(actual) || !path.isAbsolute(expected)) return false;
  try { return await realpath(actual) === await realpath(expected); }
  catch { return false; }
}

async function matchesTask(workflow, task, cwd) {
  const args = task.planArguments;
  return args && workflow.objective === args.objective &&
    await sameCheckout(workflow.cwd, args.worktreeCwd ?? cwd) &&
    Array.isArray(workflow.lanes) && workflow.lanes.length === args.lanes.length &&
    workflow.lanes.every((lane, i) => {
      const expected = args.lanes[i];
      return lane.objective === expected.objective && lane.readOnly === expected.readOnly &&
        lane.agentKind === expected.agentKind && isDeepStrictEqual(lane.launchProfile, expected.launchProfile);
    });
}

export async function laneStatus({ filename, cwd, records = [], sessionFile, env = process.env }) {
  const preview = await loadPreview(filename, { cwd });
  const root = await realpath(cwd);
  const current = { root, sessionFile: sessionFile ?? null, paneId: env.HERDR_PANE_ID ?? null, workspaceId: env.HERDR_WORKSPACE_ID ?? null, inHerdr: env.HERDR_ENV === '1' };
  const warnings = [];
  let workflows = [];
  let manifestReadable = false;
  try {
    const manifest = JSON.parse(await readFile(path.join(root, '.pi/herdr-orchestrator/manifest.json'), 'utf8'));
    if (!Array.isArray(manifest?.workflows)) throw new Error('workflows must be an array');
    if (manifest.workflows.some(workflow => !workflow || typeof workflow.id !== 'string' || !Array.isArray(workflow.lanes) || workflow.lanes.some(lane => !lane || typeof lane !== 'object'))) throw new Error('invalid workflow or lane entry');
    if (manifest.workflows.some(workflow => ['approvalRequests', 'questionRequests'].some(key => workflow[key] !== undefined &&
      (!Array.isArray(workflow[key]) || workflow[key].some(item => !item || typeof item.id !== 'string' || typeof item.status !== 'string')))))
      throw new Error('invalid approval or question request list');
    workflows = manifest.workflows;
    manifestReadable = true;
  } catch (error) {
    warnings.push(error.code === 'ENOENT' ? 'No Baa-ton manifest in this checkout. This may be the wrong project root.' : `Cannot read Baa-ton manifest: ${error.message}`);
  }
  const briefRecords = records.filter(record => record.sourcePath === preview.sourcePath);
  if (!briefRecords.length) warnings.push('No adapter records for this brief in the current session branch. This does not mean the task has never run; check the owning project and root session.');
  if (!current.inHerdr) warnings.push('Current process is outside a confirmed Herdr environment; this report does not establish root identity.');
  const staleRecordCount = briefRecords.filter(record => record.sourceSha256 !== preview.sourceSha256).length;
  if (staleRecordCount) warnings.push(`${staleRecordCount} record(s) belong to an older brief/profile snapshot and are not used as current verification.`);
  const tasks = [];
  const facts = new Map();
  for (const task of preview.workflows) {
    const history = briefRecords.filter(record => record.sourceSha256 === preview.sourceSha256 && record.taskId === task.taskId && record.root === root);
    const mapped = history.findLast(record => record.kind === 'planned');
    const verified = mapped && history.findLast(record => record.kind === 'verified' && record.workflowId === mapped.workflowId);
    const prepared = history.findLast(record => record.kind === 'prepared');
    const submitted = history.findLast(record => record.kind === 'planning' && !submissionRecovered(record, history));
    const matching = mapped ? [] : await Promise.all(workflows.map(workflow => matchesTask(workflow, task, root)));
    const candidates = mapped ? workflows.filter(workflow => workflow.id === mapped.workflowId) : workflows.filter((workflow, index) => matching[index]);
    const workflow = candidates.length === 1 ? candidates[0] : undefined;
    const binding = workflow?.taskBinding;
    const owner = binding ? { root, sessionFile: binding.rootSessionPath ?? null, paneId: binding.rootPaneId ?? null, workspaceId: binding.workspaceId ?? null } : mapped || prepared || submitted ? { root, sessionFile: (mapped ?? prepared ?? submitted).sessionFile ?? null, paneId: (mapped ?? prepared ?? submitted).paneId ?? null, workspaceId: (mapped ?? prepared ?? submitted).workspaceId ?? null } : null;
    const receiptLanes = workflow?.lanes?.filter(receiptPresent) ?? [];
    const receipts = receiptLanes.length;
    const receiptDelivery = {};
    for (const lane of receiptLanes) {
      const state = ['pending', 'sending', 'delivered', 'uncertain'].includes(lane.completionReceipt.delivery) ? lane.completionReceipt.delivery : 'unknown';
      receiptDelivery[state] = (receiptDelivery[state] ?? 0) + 1;
    }
    const complete = Boolean(workflow?.lanes?.length && receipts === workflow.lanes.length);
    const blockers = [];
    const ownerMismatch = Boolean(owner && (!current.inHerdr || owner.root !== root || owner.paneId !== current.paneId || owner.workspaceId !== current.workspaceId || (owner.sessionFile && owner.sessionFile !== current.sessionFile)));
    const ownerIncomplete = Boolean(workflow && (!binding?.rootSessionPath || !binding?.rootPaneId || !binding?.workspaceId));
    const mappingMismatch = Boolean(mapped && workflow && !await matchesTask(workflow, task, root));
    if (ownerMismatch) blockers.push('Current context does not match the owning Herdr root session, pane, or workspace. Switch to that root; do not reset its mapping.');
    if (mapped && !workflow) blockers.push('Mapped workflow is missing or ambiguous in the current manifest; inspect the ledger.');
    if (mappingMismatch) blockers.push('Mapped workflow no longer matches this task’s objective, checkout, lane scope or profile; inspect the ledger.');
    if (ownerIncomplete) blockers.push('Durable workflow ownership is incomplete; inspect its root/session binding before acting.');
    if (workflow && !mapped) blockers.push('Durable workflow found without an adapter mapping; reconcile in its owning root before verification.');
    if (!mapped && candidates.length > 1) blockers.push('Multiple matching workflows exist; select and reconcile the correct one explicitly.');
    if (submitted && !mapped) blockers.push('A submission was recorded without a mapped result. Inspect the durable ledger before retrying.');
    if (verified && !complete) blockers.push('Historical verification exists but complete durable receipts are now missing; inspect the ledger.');
    let prepareCheck = 'not-run';
    let localPrepared;
    const lastPreview = briefRecords.findLast(record => record.kind === 'preview');
    if (!mapped && !submitted && candidates.length === 0) {
      try {
        localPrepared = await prepareLane({ filename: preview.sourcePath, taskId: task.taskId, preview: lastPreview, cwd: root, records, env });
        prepareCheck = 'passed';
      } catch (error) {
        prepareCheck = 'blocked';
        blockers.push(error.message);
      }
    }
    const preparationCurrent = currentPreparation(prepared, localPrepared, current);
    tasks.push({ taskId: task.taskId, repoCwd: task.repoCwd ?? root, state: verified ? 'verified' : mapped ? complete ? 'completed-unverified' : 'mapped' : candidates.length ? 'unmapped-workflow' : submitted ? 'submitted-unmapped' : prepared ? 'prepared' : 'untracked', workflowId: mapped?.workflowId ?? workflow?.id ?? null, candidateWorkflowIds: candidates.map(item => item.id), owner, workflowStatus: workflow?.status ?? null, completionReceipts: receipts, laneCount: workflow?.lanes?.length ?? 0, receiptDelivery, verification: verified ? { commit: verified.commit, evidence: verified.evidence, verifiedAt: verified.verifiedAt } : null, dependencies: task.afterVerifiedAndIntegrated, prepareCheck, savedPreparationCurrent: preparationCurrent, blockers,
      pendingApprovals: (workflow?.approvalRequests ?? []).filter(item => item.status === 'parent-approval-required').map(({ id, action, request }) => ({ id, action, request })),
      pendingQuestions: (workflow?.questionRequests ?? []).filter(item => item.status === 'parent-question-required').map(({ id, question }) => ({ id, question })),
      pendingAnswers: (workflow?.questionRequests ?? []).filter(item => item.status === 'answer-delivery-pending').map(({ id, delivery }) => ({ id, delivery })),
    });
    facts.set(task.taskId, { current, manifestReadable, ownerMismatch, ownerIncomplete, ambiguous: candidates.length > 1, mappingMismatch,
      mapped, submitted, workflow, preparationCurrent, plannable: Boolean(task.planArguments),
      profileResolved: task.planArguments?.lanes.every(lane => Boolean(lane.launchProfile)),
      previewCurrent: lastPreview?.sourceSha256 === preview.sourceSha256,
      historicalSubmission: briefRecords.some(record => record.root === root && record.taskId === task.taskId &&
        record.sourceSha256 !== preview.sourceSha256 && (record.kind === 'planned' || (record.kind === 'planning' && !submissionRecovered(record, briefRecords)))),
    });
  }
  for (const task of tasks) task.nextAction = nextAction(task, facts.get(task.taskId), tasks);
  return { mode: 'read-only-status', authorization: 'not-assessed', nativeReadiness: 'not-checked', current, sourcePath: preview.sourcePath, sourceSha256: preview.sourceSha256, manifestReadable, staleRecordCount, warnings, tasks, nextAction: recommendedAction(tasks) };
}

export function renderStatus(report) {
  return [
    `Current root: ${report.current.root}`,
    `Pane: ${report.current.paneId ?? 'outside Herdr'} | Workspace: ${report.current.workspaceId ?? 'unknown'}`,
    `Session: ${report.current.sessionFile ?? 'unknown'}`,
    `Brief: ${report.sourcePath}`,
    'Read-only snapshot. Saved verification is historical evidence; tests were not rerun. Prepare checks report the first failure and do not attest live Baa-ton readiness.',
    'Next actions are advice, not authorization. No native probes, dispatch, approvals or workflow writes were performed.',
    report.nextAction ? `Suggested next: ${report.nextAction.taskId} — ${report.nextAction.label}` : 'No further lane action suggested; recorded verification remains historical.',
    ...report.warnings.map(warning => `Warning: ${warning}`), '',
    ...report.tasks.flatMap(task => [
      `${task.taskId}: ${task.state} | Workflow: ${task.workflowId ?? 'unmapped'}`,
      `Repository: ${task.repoCwd}`,
      `Owner: ${task.owner ? `${task.owner.root} | ${task.owner.workspaceId ?? '?'} | ${task.owner.paneId ?? '?'} | ${task.owner.sessionFile ?? 'session unknown'}` : 'not established in this root'}`,
      `Baa-ton status: ${task.workflowStatus ?? 'unknown'} | Receipts: ${task.completionReceipts}`,
      `Receipt delivery: ${Object.entries(task.receiptDelivery).map(([state, count]) => `${state}=${count}`).join(', ') || 'none'}`,
      `Verification: ${task.verification ? `${task.verification.commit} at ${task.verification.verifiedAt ?? 'unknown time'}` : 'not recorded for this brief in this session'}`,
      `Dependencies: ${task.dependencies.join(', ') || 'none'} | Prepare check: ${task.prepareCheck}`,
      ...task.blockers.map(blocker => `Blocked: ${blocker}`),
      `Next [${task.nextAction.category}]: ${task.nextAction.label}`,
      `Why: ${task.nextAction.reason}`,
      ...task.pendingQuestions.map(item => `Question ${item.id}: ${item.question ?? 'inspect the saved request'}`),
      ...task.pendingApprovals.map(item => `Approval ${item.id} (${item.action}): ${item.request ?? 'inspect the saved request'}`), '',
    ]),
  ].join('\n');
}
