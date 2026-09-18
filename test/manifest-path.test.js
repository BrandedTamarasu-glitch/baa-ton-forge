import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveManifestPath } from '../manifest-path.js';
import { readManifestSnapshot, assertSnapshotUnchanged } from '../manifest-snapshot.js';
import { recoverSubmission } from '../recovery.js';

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'forge manifest ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const current = path.join(root, '.baa-ton/herdr-orchestrator/manifest.json');
  const legacy = path.join(root, '.pi/herdr-orchestrator/manifest.json');
  const save = async (filename, bytes = '{"version":2,"workflows":[]}') => {
    await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes);
  };
  return { root, current, legacy, save };
}

test('manifest resolution supports current and legacy files without creating or migrating state', async t => {
  const f = await fixture(t);
  assert.equal(await resolveManifestPath(f.root), f.current);
  for (const filename of [f.current, f.legacy]) {
    assert.equal(await resolveManifestPath(f.root, { registeredPath: filename }), filename);
    await f.save(filename);
    const before = await readFile(filename);
    assert.equal(await resolveManifestPath(f.root), filename);
    const { snapshot } = await readManifestSnapshot(f.root, {});
    assert.equal(snapshot.path, filename); assert.equal(snapshot.exists, true);
    assert.deepEqual(await readFile(filename), before);
    await rm(filename);
  }
  assert.equal((await readManifestSnapshot(f.root, {})).snapshot.exists, false);
});

test('dual manifests and registered-path disagreement cannot silently select another ledger', async t => {
  const f = await fixture(t);
  await f.save(f.legacy);
  await assert.rejects(resolveManifestPath(f.root, { registeredPath: f.current }), /disagrees/);
  await f.save(f.current);
  for (const registeredPath of [undefined, f.current, f.legacy])
    await assert.rejects(resolveManifestPath(f.root, { registeredPath }), /Ambiguous Baa-ton manifests/);
  await rm(f.legacy);
  await assert.rejects(resolveManifestPath(f.root, { registeredPath: path.join(f.root, 'other/manifest.json') }), /another checkout or unsupported/);
  await assert.rejects(resolveManifestPath(f.root, { registeredPath: '../manifest.json' }), /absolute/);
  await f.save(f.current, 'invalid');
  await assert.rejects(readManifestSnapshot(f.root, {}), SyntaxError);
});

test('manifest snapshots cannot recover against a different layout even with identical contents', async t => {
  const f = await fixture(t), owner = { paneId: 'p', workspaceId: 'w', sessionFile: '/session' };
  await f.save(f.legacy);
  const { snapshot: saved } = await readManifestSnapshot(f.root, owner);
  await rm(f.legacy); await f.save(f.current);
  const { snapshot: current } = await readManifestSnapshot(f.root, owner);
  assert.equal(saved.stateSha256, current.stateSha256);
  assert.throws(() => assertSnapshotUnchanged(saved, current, Date.now(), owner), /path differs/);
});

test('manifest resolver accepts root directory aliases and rejects non-files and escaped state directories', async t => {
  const f = await fixture(t);
  const alias = path.join(f.root, 'alias');
  await symlink(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await resolveManifestPath(alias, { registeredPath: path.join(alias, '.baa-ton/herdr-orchestrator/manifest.json') }), f.current);
  await mkdir(f.current, { recursive: true });
  await assert.rejects(resolveManifestPath(f.root), /regular non-symlink/);
  await rm(path.join(f.root, '.baa-ton'), { recursive: true });
  const external = await fixture(t);
  await symlink(external.root, path.join(f.root, '.baa-ton'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(resolveManifestPath(f.root), /outside the root checkout/);
});

for (const directory of ['.baa-ton/herdr-orchestrator', '.pi/herdr-orchestrator'])
test(`rejected submission recovery reads ${directory} and preserves its snapshot`, async t => {
  const f = await fixture(t), filename = path.join(f.root, 'brief.json');
  const manifest = path.join(f.root, directory, 'manifest.json');
  await f.save(manifest);
  const env = { HERDR_ENV: '1', HERDR_PANE_ID: 'p', HERDR_WORKSPACE_ID: 'w' }, sessionFile = path.join(f.root, 'session.jsonl');
  const owner = { paneId: 'p', workspaceId: 'w', sessionFile };
  const { snapshot } = await readManifestSnapshot(f.root, owner);
  const before = await readFile(manifest);
  const timestamp = new Date(Date.now() + 10).toISOString(), toolCallId = 'call';
  const planArguments = { objective: 'Trial', worktreeCwd: path.join(f.root, 'writer') };
  const record = { kind: 'planning', root: f.root, taskId: 'writer', sourcePath: filename,
    sourceSha256: 'brief-hash', ...owner, planArguments, toolCallId, manifestSnapshot: snapshot };
  const entries = [
    { id: 'call', type: 'message', timestamp, message: { role: 'assistant', content: [{ type: 'toolCall', id: toolCallId, name: 'herdr_plan', arguments: planArguments }] } },
    { id: 'planning', type: 'custom', customType: 'forgeflow-adapter', timestamp, data: record },
    { id: 'result', type: 'message', timestamp, message: { role: 'toolResult', toolName: 'herdr_plan', toolCallId, isError: true, content: [{ type: 'text', text: 'Herdr worktree list response is missing source_workspace_id.' }] } },
  ];
  const options = { filename, taskId: 'writer', cwd: f.root, entries, sessionFile, env };
  assert.equal((await recoverSubmission(options)).evidence.manifestPath, manifest);
  // Older records have timestamp evidence rather than saved snapshot evidence.
  delete record.manifestSnapshot;
  assert.equal((await recoverSubmission(options)).evidence.manifestPath, manifest);
  assert.deepEqual(await readFile(manifest), before);
  assert.equal(entries.length, 3);
});
