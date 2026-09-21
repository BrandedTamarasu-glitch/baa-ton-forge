import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadPreview } from '../../planner.js';
import { prepareLane } from '../../prepare.js';
import { nativePreflight } from '../../preflight.js';
import { nativeFixture } from '../native-fixture.js';

export const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export async function startupRetryFixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'startup retry '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'root'), target = path.join(base, 'writer'); await mkdir(root);
  git(root, 'init'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(root, 'file.txt'), 'baseline'); git(root, 'add', '.'); git(root, 'commit', '-m', 'baseline');
  await writeFile(path.join(root, '.git/info/exclude'), '.pi/\n'); git(root, 'worktree', 'add', '-b', 'writer', target);
  const profile = { provider: 'claude-code', model: 'exact-model', thinking: 'high', auth: 'subscription' };
  const filename = path.join(base, 'brief.json');
  await writeFile(filename, JSON.stringify({ version: 1, objective: 'Trial', acceptance: ['Correct file'], tasks: [{ id: 'writer', objective: 'Change file', files: ['file.txt'], checks: ['Inspect file'], agentKind: 'claude', launchProfile: profile, worktreeCwd: target }] }));
  const env = { HERDR_ENV: '1', HERDR_PANE_ID: 'p1', HERDR_WORKSPACE_ID: 'w1' };
  const native = await nativeFixture({ root, target }, env);
  const preview = await loadPreview(filename, { cwd: root });
  const prepared = await prepareLane({ filename, taskId: 'writer', cwd: root, env: native.env, preview });
  const readiness = await nativePreflight({ prepared, sessionFile: native.sessionFile, env: native.env, exec: native.exec });
  const dir = path.join(prepared.root, '.pi/herdr-orchestrator'); await mkdir(dir, { recursive: true });
  const startup = path.join(dir, 'herdr-one-lane-1-startup.json');
  const lane = { ...prepared.planArguments.lanes[0], id: 'lane-1', status: 'idle', agentStartAttemptedAt: 'time', paneId: 'child', tabId: 'tab', agentName: 'worker', incarnationId: 'incarnation', startupNonce: 'nonce', startupIntentPath: startup, agentSessionPath: 'child-session', dependencies: [] };
  const flow = { id: 'herdr-one', status: 'dispatch-failed', cwd: prepared.target, objective: prepared.planArguments.objective, lanes: [lane],
    retry: { state: 'retryable', failedStage: 'agent-start', error: 'agent_not_ready', attempt: 1 },
    taskBinding: { rootPaneId: 'p1', workspaceId: 'w1', rootSessionPath: native.sessionFile },
    worktreeBinding: { repoParent: { workspaceId: 'source-workspace', checkoutPath: root } },
    ownership: { createdBy: 'herdr-orchestrator', workspaceId: 'w1', paneIds: ['child'], tabIds: ['tab'] } };
  const manifestPath = path.join(dir, 'manifest.json');
  const save = () => writeFile(manifestPath, JSON.stringify({ version: 2, workflows: [flow] })); await save();
  const intentProof = { version: 1, workflowId: flow.id, laneId: lane.id, incarnationId: lane.incarnationId, nonce: 'nonce', paneId: 'child', workspaceId: 'w1', source: 'native-baa', profile };
  const ready = { version: 1, nonce: 'nonce', paneId: 'child', workspaceId: 'w1', source: 'native-baa', profile, harness: 'claude', sessionId: 'child-session', operations: ['plan','dispatch','complete'] };
  await writeFile(startup, JSON.stringify(intentProof)); await writeFile(startup+'.ready', JSON.stringify(ready));
  const previous = { kind: 'dispatch-intent', intentId: 'initial', workflowId: flow.id, sourcePath: filename, sourceSha256: preview.sourceSha256, taskId: 'writer', root: prepared.root, sessionFile: native.sessionFile, paneId: 'p1', workspaceId: 'w1' };
  const records = [{ kind: 'preview', ...preview }, { ...prepared, nativeReadiness: readiness, sessionFile: native.sessionFile },
    { ...prepared, kind: 'planned', workflowId: flow.id, sessionFile: native.sessionFile }, previous,
    { kind: 'dispatch-attempt', intentId: 'initial', toolCallId: 'original-call' },
    { kind: 'dispatch-result', intentId: 'initial', toolCallId: 'original-call', outcome: 'error', isError: true, resultText: 'agent_not_ready' }];
  const agent = { agent: 'claude', pane_id: 'child', tab_id: 'tab', workspace_id: 'w1', name: 'worker', cwd: target, agent_status: 'idle', interactive_ready: true, agent_session: { kind: 'id', value: 'child-session' } };
  const exec = async (binary, args) => args[0] === 'agent' && args[2] === 'child'
    ? { code: 0, stdout: JSON.stringify({ result: { agent } }) } : native.exec(binary, args);
  const options = { previous, records, filename, cwd: root, sessionFile: native.sessionFile, env: native.env, exec };
  return { options, flow, save, agent, startup, ready, manifestPath, target, native };
}
