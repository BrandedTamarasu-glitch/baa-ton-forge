import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const control = /[\u0000-\u001f\u007f]/;
export function validSessionPath(value) {
  return typeof value === 'string' && path.isAbsolute(value) && !control.test(value);
}

// Exact historical identities remain usable if the transcript was archived.
// Different spellings require a real, existing file on both sides. Never repair
// escape sequences, compare just a basename/UUID, or fold case on POSIX.
export async function sameSessionPath(actual, expected) {
  if (!validSessionPath(actual) || !validSessionPath(expected)) return false;
  if (actual === expected) return true;
  try {
    const [a, b] = await Promise.all([realpath(actual), realpath(expected)]);
    return a === b && (await stat(a)).isFile();
  } catch { return false; }
}

export async function assertLiveSession(agentSession, sessionFile, env = process.env) {
  const values = { liveAgentSession: agentSession?.value ?? null, nativePiSession: sessionFile,
    PI_SESSION_FILE: env.PI_SESSION_FILE ?? null };
  const malformed = Object.values(values).some(value => typeof value === 'string' && control.test(value));
  if (agentSession?.kind === 'path' && !malformed && await sameSessionPath(agentSession.value, sessionFile) &&
      (env.PI_SESSION_FILE === undefined || await sameSessionPath(env.PI_SESSION_FILE, sessionFile))) return;
  throw new Error(`Live root session differs from this Pi session. ${malformed ? 'Control characters detected; this is not a path alias. ' : ''}` +
    `Escaped path evidence: ${JSON.stringify(values)}. ` +
    'Stop preparation. In the owning Herdr pane, compare herdr agent get session metadata with the native Pi session file and PI_SESSION_FILE. ' +
    'Resume the actual owning Pi session if different; if native metadata is stale or corrupted, repair the Baa-ton/Herdr session-path registration, then run native herdr_reconcile_root and herdr_doctor there. ' +
    'If doctor still fails, report its exact root-identity diagnostic to Baa-ton; do not reset roots, rewrite ledgers, strip characters, or substitute a session UUID.');
}
