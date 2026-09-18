import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { sameSessionPath, assertLiveSession } from '../session-path.js';

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'Forge Session ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'Sessions'), alias = path.join(root, 'alias');
  await mkdir(dir);
  const file = path.join(dir, 'actual.jsonl'); await writeFile(file, 'session');
  await symlink(dir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  return { root, dir, file, alias: path.join(alias, 'actual.jsonl') };
}

test('session ownership accepts filesystem-proven aliases and native Windows formatting', async t => {
  const f = await fixture(t);
  const spellings = [f.file, f.alias, `${f.dir}${path.sep}.${path.sep}actual.jsonl`];
  if (process.platform === 'win32') spellings.push(f.file.replaceAll('\\', '/'), f.file.toUpperCase(), `\\\\?\\${f.file}`);
  for (const value of spellings) {
    assert.equal(await sameSessionPath(value, f.file), true, value);
    await assertLiveSession({ kind: 'path', value }, f.file, { PI_SESSION_FILE: f.alias });
  }
  assert.equal(await sameSessionPath(path.join(f.root, 'archived.jsonl'), path.join(f.root, 'archived.jsonl')), true);
});

test('session matching rejects missing aliases, relative paths, different files and corrupt control bytes', async t => {
  const f = await fixture(t), other = path.join(f.root, 'actual.jsonl'); await writeFile(other, 'session');
  for (const value of [other, path.join(f.root, 'missing.jsonl'), 'actual.jsonl', '', null,
    f.file.replace('Sessions', 'Ses\u0007sions'), `${f.file}\u0002`, `${f.file}\t`, `${f.file}\n`]) {
    assert.equal(await sameSessionPath(value, f.file), false);
    await assert.rejects(assertLiveSession({ kind: 'path', value }, f.file, {}), /Live root session differs/);
  }
  const corrupt = `${f.file}\u0007`;
  assert.equal(await sameSessionPath(corrupt, corrupt), false);
  await assert.rejects(assertLiveSession({ kind: 'path', value: corrupt }, corrupt, {}), error => {
    assert.match(error.message, /Control characters detected/);
    assert.match(error.message, /\\u0007/);
    assert.equal(error.message.includes('\u0007'), false);
    assert.match(error.message, /herdr_reconcile_root and herdr_doctor/);
    return true;
  });
  await assert.rejects(assertLiveSession({ kind: 'id', value: f.file }, f.file, {}), /Live root session differs/);
  await assert.rejects(assertLiveSession({ kind: 'path', value: f.file }, f.file, { PI_SESSION_FILE: other }), /PI_SESSION_FILE/);
  // Win32 normalizes .. before opening the path; POSIX requires the intermediate
  // directory to exist. Follow the filesystem's proof, not a cross-platform guess.
  assert.equal(await sameSessionPath(`${f.root}/missing/../Sessions/actual.jsonl`, f.file), process.platform === 'win32');
  if (process.platform !== 'win32') assert.equal(await sameSessionPath(f.file.toUpperCase(), f.file), false);
});
