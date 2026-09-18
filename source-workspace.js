import { lstat, mkdir, open, readFile, rename, rmdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

// Shared by linked checkouts and controller roots. Git metadata keeps this audit
// outside the application diff. Never reclaim a lock automatically after a crash.
export async function ensureSourceWorkspace({ initial, probe }) {
  const directory = path.join(initial.commonDir, 'forgeflow-source-workspaces');
  await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe source-workspace audit directory');
  const lock = path.join(directory, 'setup.lock');
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Source-workspace setup is already locked; inspect ${lock} before retrying. No duplicate creation attempted.`);
    throw error;
  }
  const key = createHash('sha256').update(initial.sourceCheckout).digest('hex');
  const journalPath = path.join(directory, `${key}.json`);
  let journal;
  async function save() {
    const temporary = `${journalPath}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, journalPath);
  }
  try {
    let previous;
    try {
      const file = await lstat(journalPath);
      if (!file.isFile() || file.isSymbolicLink()) throw new Error('Unsafe source-workspace journal');
      previous = JSON.parse(await readFile(journalPath, 'utf8'));
      if (previous.version !== 1 || previous.sourceCheckout !== initial.sourceCheckout ||
          previous.repoKey !== initial.repoKey || !Array.isArray(previous.attempts) ||
          previous.attempts.some(item => !item || typeof item.id !== 'string' || !item.id ||
            !['creating', 'bound'].includes(item.status) ||
            (item.status === 'bound' && (typeof item.workspaceId !== 'string' || !item.workspaceId))))
        throw new Error('Invalid source-workspace journal; inspect setup history');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    journal = previous ?? { version: 1, sourceCheckout: initial.sourceCheckout, repoKey: initial.repoKey, attempts: [] };
    const before = await probe();
    if (!before.missing) return before.readiness;
    if (journal.attempts.some(item => item.status === 'creating'))
      throw new Error(`A previous source-workspace creation has an unresolved outcome; inspect ${journalPath} and native inventory. No automatic retry.`);
    // If an earlier successfully bound workspace still exists but lost its
    // source association, do not create another one beside it.
    if (journal.attempts.some(item => before.spaces.some(space => space.workspace_id === item.workspaceId)))
      throw new Error('Previously created source workspace still exists without its binding; inspect it before preparing');
    const attempt = { id: randomUUID(), status: 'creating', startedAt: new Date().toISOString(), owner: initial.readiness.root };
    journal.attempts.push(attempt);
    await save(); // Intent survives a lost response or extension/process crash.
    try {
      const created = await before.inspect(['workspace', 'create', '--cwd', before.sourceCheckout,
        '--label', `Forge source ${key.slice(0, 12)}`, '--no-focus']);
      const workspaceId = created.workspace_id ?? created.workspace?.workspace_id;
      if (typeof workspaceId !== 'string' || !workspaceId ||
          (created.workspace?.workspace_id && created.workspace.workspace_id !== workspaceId))
        throw new Error('Native workspace creation returned no unambiguous workspace ID');
      attempt.workspaceId = workspaceId;
      await save();
      const after = await probe();
      if (after.missing || after.readiness.source?.workspaceId !== workspaceId)
        throw new Error('Created workspace did not establish the expected native source binding');
      attempt.status = 'bound';
      attempt.verifiedAt = new Date().toISOString();
      await save();
      return after.readiness;
    } catch (error) {
      throw new Error(`Source-workspace setup could not be confirmed: ${error instanceof Error ? error.message : String(error)}. Inspect ${journalPath}; resources preserved, no automatic creation retry.`);
    }
  } finally { await rmdir(lock); }
}
