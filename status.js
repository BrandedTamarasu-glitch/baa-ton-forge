import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { loadPreview } from './planner.js';
import { prepareLane } from './prepare.js';
import { submissionRecovered } from './recovery.js';

function matchesTask(workflow, task, cwd) {
  const args = task.planArguments;
  return args && workflow.objective === args.objective &&
    workflow.cwd === (args.worktreeCwd ?? cwd) &&
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
  for (const task of preview.workflows) {
    const history = briefRecords.filter(record => record.sourceSha256 === preview.sourceSha256 && record.taskId === task.taskId && record.root === root);
    const mapped = history.findLast(record => record.kind === 'planned');
    const verified = mapped && history.findLast(record => record.kind === 'verified' && record.workflowId === mapped.workflowId);
    const prepared = history.findLast(record => record.kind === 'prepared');
    const submitted = history.findLast(record => record.kind === 'planning' && !submissionRecovered(record, history));
    const candidates = mapped ? workflows.filter(workflow => workflow.id === mapped.workflowId) : workflows.filter(workflow => matchesTask(workflow, task, root));
    const workflow = candidates.length === 1 ? candidates[0] : undefined;
    const binding = workflow?.taskBinding;
    const owner = binding ? { root, sessionFile: binding.rootSessionPath ?? null, paneId: binding.rootPaneId ?? null, workspaceId: binding.workspaceId ?? null } : mapped || prepared || submitted ? { root, sessionFile: (mapped ?? prepared ?? submitted).sessionFile ?? null, paneId: (mapped ?? prepared ?? submitted).paneId ?? null, workspaceId: (mapped ?? prepared ?? submitted).workspaceId ?? null } : null;
    const receipts = workflow?.lanes?.filter(lane => lane.completionReceipt?.id && lane.completionReceipt?.summary).length ?? 0;
    const complete = Boolean(workflow?.lanes?.length && receipts === workflow.lanes.length);
    const blockers = [];
    if (owner && (!current.inHerdr || owner.root !== root || owner.paneId !== current.paneId || owner.workspaceId !== current.workspaceId || (owner.sessionFile && owner.sessionFile !== current.sessionFile))) blockers.push('Current context does not match the owning Herdr root session, pane, or workspace. Switch to that root; do not reset its mapping.');
    if (mapped && !workflow) blockers.push('Mapped workflow is missing or ambiguous in the current manifest; inspect the ledger.');
    if (workflow && !mapped) blockers.push('Durable workflow found without an adapter mapping; reconcile in its owning root before verification.');
    if (!mapped && candidates.length > 1) blockers.push('Multiple matching workflows exist; select and reconcile the correct one explicitly.');
    if (submitted && !mapped) blockers.push('A submission was recorded without a mapped result. Inspect the durable ledger before retrying.');
    let prepareCheck = 'not-run';
    if (!mapped && !submitted && candidates.length === 0) {
      const lastPreview = briefRecords.findLast(record => record.kind === 'preview');
      try {
        await prepareLane({ filename: preview.sourcePath, taskId: task.taskId, preview: lastPreview, cwd: root, records, env });
        prepareCheck = 'passed';
      } catch (error) {
        prepareCheck = 'blocked';
        blockers.push(error.message);
      }
    }
    tasks.push({ taskId: task.taskId, repoCwd: task.repoCwd ?? root, state: verified ? 'verified' : mapped ? complete ? 'completed-unverified' : 'mapped' : candidates.length ? 'unmapped-workflow' : submitted ? 'submitted-unmapped' : prepared ? 'prepared' : 'untracked', workflowId: mapped?.workflowId ?? workflow?.id ?? null, candidateWorkflowIds: candidates.map(item => item.id), owner, workflowStatus: workflow?.status ?? null, completionReceipts: receipts, verification: verified ? { commit: verified.commit, evidence: verified.evidence, verifiedAt: verified.verifiedAt } : null, dependencies: task.afterVerifiedAndIntegrated, prepareCheck, blockers });
  }
  return { mode: 'read-only-status', current, sourcePath: preview.sourcePath, sourceSha256: preview.sourceSha256, manifestReadable, staleRecordCount, warnings, tasks };
}

export function renderStatus(report) {
  return [
    `Current root: ${report.current.root}`,
    `Pane: ${report.current.paneId ?? 'outside Herdr'} | Workspace: ${report.current.workspaceId ?? 'unknown'}`,
    `Session: ${report.current.sessionFile ?? 'unknown'}`,
    `Brief: ${report.sourcePath}`,
    'Read-only snapshot. Saved verification is historical evidence; tests were not rerun. Prepare checks report the first failure and do not attest live Baa-ton readiness.',
    ...report.warnings.map(warning => `Warning: ${warning}`), '',
    ...report.tasks.flatMap(task => [
      `${task.taskId}: ${task.state} | Workflow: ${task.workflowId ?? 'unmapped'}`,
      `Repository: ${task.repoCwd}`,
      `Owner: ${task.owner ? `${task.owner.root} | ${task.owner.workspaceId ?? '?'} | ${task.owner.paneId ?? '?'} | ${task.owner.sessionFile ?? 'session unknown'}` : 'not established in this root'}`,
      `Baa-ton status: ${task.workflowStatus ?? 'unknown'} | Receipts: ${task.completionReceipts}`,
      `Verification: ${task.verification ? `${task.verification.commit} at ${task.verification.verifiedAt ?? 'unknown time'}` : 'not recorded for this brief in this session'}`,
      `Dependencies: ${task.dependencies.join(', ') || 'none'} | Prepare check: ${task.prepareCheck}`,
      ...task.blockers.map(blocker => `Blocked: ${blocker}`), '',
    ]),
  ].join('\n');
}
