import { lstat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { resolveManifestPath } from './manifest-path.js';

const hash = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function stateHash(manifest, owner) {
  const state = structuredClone(manifest), log = state.sessionLog;
  // Ignore only two volatile fields in a known, identity-matched root log.
  // All workflows, goals, queues, other root logs, and unknown fields remain hashed.
  if (log?.kind === 'root' && log.paneId === owner.paneId && log.workspaceId === owner.workspaceId &&
      log.sessionRef?.provider === 'pi' && log.sessionRef?.sessionId === owner.sessionFile &&
      log.sessionRef?.nativeHandle?.kind === 'path' && log.sessionRef.nativeHandle.value === owner.sessionFile) {
    delete log.status;
    delete log.lastResponseAt;
  }
  return hash(JSON.stringify(canonical(state)));
}
export async function readManifestSnapshot(root, owner, env = process.env) {
  const filename = await resolveManifestPath(root, { env });
  let before;
  try { before = await lstat(filename); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { snapshot: { version: 1, path: filename, exists: false, capturedAt: new Date().toISOString(), owner }, manifest: null };
  }
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Manifest snapshot requires a regular non-symlink file');
  const bytes = await readFile(filename, 'utf8');
  const manifest = JSON.parse(bytes);
  if (![1, 2].includes(manifest.version) || !Array.isArray(manifest.workflows)) throw new Error('Cannot snapshot an invalid Baa-ton manifest');
  const after = await lstat(filename);
  if (['ino', 'dev', 'mtimeMs', 'ctimeMs', 'size'].some(key => before[key] !== after[key]) || await resolveManifestPath(root, { env }) !== filename)
    throw new Error('Manifest changed during snapshot; retry preparation');
  return { snapshot: { version: 1, path: filename, exists: true, capturedAt: new Date().toISOString(), owner,
    rawSha256: hash(bytes), stateSha256: stateHash(manifest, owner) }, manifest };
}

export function assertSnapshotUnchanged(saved, current, started, owner) {
  if (saved?.version !== 1 || saved.path !== current.path || typeof saved.exists !== 'boolean' ||
      !isDeepStrictEqual(saved.owner, owner) || !Number.isFinite(Date.parse(saved.capturedAt)) ||
      Date.parse(saved.capturedAt) > started) throw new Error('Saved pre-submission manifest snapshot is invalid or selected path differs from the saved snapshot');
  if (saved.exists !== current.exists || (saved.exists &&
      (!/^[a-f0-9]{64}$/.test(saved.stateSha256 ?? '') || saved.stateSha256 !== current.stateSha256)))
    throw new Error('Manifest differs from the saved pre-submission snapshot; inspect durable effects before retrying');
}
