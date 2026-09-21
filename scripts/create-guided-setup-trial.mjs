#!/usr/bin/env node
import { mkdtemp, mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { previewTaskSetup } from '../task-setup.js';

// Creates only a disposable application fixture and instructions. Native Pi
// tools must create the actual brief, branch, worktrees and session records.
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
if (process.argv.length !== 3) throw new Error('Usage: node scripts/create-guided-setup-trial.mjs /absolute/controller/checkout');
if (!path.isAbsolute(process.argv[2])) throw new Error('Controller path must be absolute');
const controller = await realpath(process.argv[2]);
const adapter = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(await readFile(path.join(controller, '.baa-ton/config.json'), 'utf8'));
for (const name of ['implementation', 'review']) {
  if (!config.profiles?.[name]?.launchProfile) throw new Error(`Configure the existing ${name} profile before generating this trial`);
}
const directory = await mkdtemp(path.join(os.tmpdir(), 'forge-guided-setup-trial-'));
const repo = path.join(directory, 'trial application');
await mkdir(repo);
git(repo, 'init', '-b', 'main');
git(repo, 'config', 'user.name', 'Baa-ton Forge Trial');
git(repo, 'config', 'user.email', 'forge-trial@example.invalid');
await writeFile(path.join(repo, 'status.txt'), 'pending\n');
await writeFile(path.join(repo, 'check.mjs'), `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const mode = process.argv[2];
assert.ok(['baseline', 'ready'].includes(mode), 'Use baseline or ready');
assert.equal(readFileSync(new URL('./status.txt', import.meta.url), 'utf8'), mode === 'baseline' ? 'pending\\n' : 'ready\\n');
console.log(mode + ' check passed');
`);
await writeFile(path.join(repo, 'README.md'), '# Disposable guided setup application\n\nOnly status.txt is in the future writer scope. The writer changes pending to ready.\nKeep check.mjs and this README unchanged. No packages or network are needed.\n');
git(repo, 'add', 'status.txt', 'check.mjs', 'README.md');
git(repo, 'commit', '-m', 'Seed disposable guided setup trial');
const baseline = execFileSync(process.execPath, ['check.mjs', 'baseline'], { cwd: repo, encoding: 'utf8' }).trim();
const request = {
  name: 'native-trial',
  objective: 'Change status.txt from pending to ready in this disposable application and independently review the integrated result.',
  acceptance: ['status.txt contains exactly ready followed by a newline.', 'Only status.txt changes; check.mjs and README.md remain unchanged.', 'The root independently validates and integrates the writer commit before reviewer preparation.'],
  files: ['status.txt'], checks: ['Run node check.mjs ready.', 'Inspect git diff against the recorded baseline; only status.txt may change.'],
  repoCwd: repo, parentDirectory: directory,
  writer: { taskProfile: 'implementation' }, reviewer: { taskProfile: 'review' },
};
const preview = await previewTaskSetup(request, controller);
const manifest = {
  status: 'fixture-ready-not-live-qualified', controller, adapter,
  adapterCommit: git(adapter, 'rev-parse', 'HEAD'), controllerCommit: git(controller, 'rev-parse', 'HEAD'),
  repo, baselineCommit: git(repo, 'rev-parse', 'HEAD'), baselineCheck: baseline,
  taskDirectory: preview.directory, brief: preview.filename,
  writer: preview.brief.tasks[0].worktreeCwd, review: preview.brief.tasks[1].worktreeCwd,
  expectedAssignments: preview.assignments.map(lane => ({ agentKind: lane.agentKind, launchProfile: lane.launchProfile })),
};
await writeFile(path.join(directory, 'setup-request.json'), JSON.stringify(request, null, 2) + '\n');
await writeFile(path.join(directory, 'fixture.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(path.join(directory, 'RESULTS.md'), `# Guided setup live result\n\nStatus: NOT RUN\n\n- Actual OS / Herdr / Pi versions:\n- Actual Forge / Baa-ton revisions:\n- Owning controller / pane / workspace / Pi session:\n- Native doctor and identity result:\n- Native setup draft ID and tool-call reference:\n- Exact resolved writer / reviewer profiles:\n- Created writer branch and writer / review paths:\n- Setup journal path / state:\n- Native prepare result and source workspace ID:\n- Repeated preparation reused the same binding:\n- Review rejected before writer verification:\n- Native herdr_plan tool-call reference and workflow ID:\n- Saved Forge mapping / manifest snapshot:\n- Final application / writer / review HEADs and status:\n- Controller HEAD / index and existing changes preserved:\n- No dispatch or completion receipts:\n- Errors and unresolved checks:\n\nDo not mark unexecuted checks passed. This trial does not qualify dispatch, integration, or review execution.\n`);
await writeFile(path.join(directory, 'RUN.md'), `# Prepared native guided setup trial

Controller: ${controller}
Fixture inventory: ${path.join(directory, 'fixture.json')}
Setup tool input: ${path.join(directory, 'setup-request.json')}
Result sheet: ${path.join(directory, 'RESULTS.md')}
Procedure: ${path.join(adapter, 'docs/guided-setup-trial.md')}

Run in the existing registered Pi root for the controller above. Load the current
Forge extension from ${path.join(adapter, 'extension.js')}. The user can enter
/reload directly in Pi; do not try to invoke it through a model tool or bash.
If both setup tools are already exposed from the updated extension, continue
without treating unavailable programmatic reload as a failure. Run Pi version
diagnostics only as standalone commands, separate from other shell checks.
If tools remain missing, fully restart Pi in the same owning pane and resume the
same session. Never run interactive Pi through rtk proxy.

The application is already initialized, committed, and baseline-checked. Its
task brief, writer branch, and writer/review worktrees deliberately do not exist.
Do not create them with shell commands: that is what the native setup tools test.

Read the procedure and inventory. Native setup must use the exact setup-request
fields and resolve the controller's implementation and review profiles. Compare
them with fixture.json; if profiles changed, report the difference before apply.
The native preview must be displayed before applying. Existing authorization
covers this exact setup, one shell-only source workspace, and one writer plan.
Continue through successful native herdr_plan and save observed evidence in
RESULTS.md. Stop before dispatch. Do not modify application contents, integrate,
verify completion, push, close resources, reset roots, or rewrite old ledgers.
On unexpected failure, stop and report its exact tool result and any created
resources. Do not retry an uncertain setup or planning operation.
`);
console.log(JSON.stringify({ directory, run: path.join(directory, 'RUN.md'), results: path.join(directory, 'RESULTS.md'), ...manifest }, null, 2));
