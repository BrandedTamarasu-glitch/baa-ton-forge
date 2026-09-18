import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export const manifestDirectories = ['.baa-ton/herdr-orchestrator', '.pi/herdr-orchestrator'];

// Resolve the nearest existing ancestor, including Windows directory aliases.
export async function canonicalPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Native path must be absolute');
  try { return await realpath(value); }
  catch (error) {
    if (error.code !== 'ENOENT' || path.dirname(value) === value) throw error;
    return path.join(await canonicalPath(path.dirname(value)), path.basename(value));
  }
}

// Read-only compatibility, not migration. Never merge ledgers or fall back from
// an invalid current manifest to legacy state. Preflight also validates the
// controller's registered path against these two checkout-local locations.
export async function resolveManifestPath(cwd, { registeredPath } = {}) {
  const root = await realpath(cwd);
  const candidates = [];
  for (const directory of manifestDirectories) {
    const filename = path.join(root, directory, 'manifest.json');
    let info;
    try { info = await lstat(filename); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (info && (!info.isFile() || info.isSymbolicLink()))
      throw new Error(`Manifest must be a regular non-symlink file: ${filename}`);
    const canonical = await canonicalPath(filename);
    const relative = path.relative(root, canonical);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error('Manifest path resolves outside the root checkout');
    candidates.push({ filename: canonical, exists: Boolean(info) });
  }
  const existing = candidates.filter(item => item.exists);
  if (new Set(existing.map(item => item.filename)).size > 1)
    throw new Error('Ambiguous Baa-ton manifests: both current and legacy layouts contain state; inspect controller registration and preserve both ledgers. No automatic migration is performed.');
  if (registeredPath !== undefined) {
    const registered = await canonicalPath(registeredPath);
    const selected = candidates.find(item => item.filename === registered);
    if (!selected) throw new Error('Registered manifest belongs to another checkout or unsupported layout');
    if (existing.length && existing[0].filename !== selected.filename)
      throw new Error('Registered manifest disagrees with the existing checkout manifest; inspect controller registration without replacing state');
    return selected.filename;
  }
  return existing[0]?.filename ?? candidates[0].filename;
}
