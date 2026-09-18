import { realpath, stat } from 'node:fs/promises';
import { validSessionPath, sameSessionPath } from './session-path.js';

const CHANNEL = 'baa-ton:pi-root-identity:v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function nativeSessionOptions(pi, ctx, signal = ctx.signal) {
  const sessionId = ctx.sessionManager?.getSessionId?.();
  const sessionFile = ctx.sessionManager?.getSessionFile?.();
  return { sessionId, proveSession: async () => {
    const proof = await requestPiRootIdentity(pi, { signal });
    if (ctx.sessionManager?.getSessionId?.() !== sessionId || ctx.sessionManager?.getSessionFile?.() !== sessionFile)
      throw new Error('Pi runtime session changed during native identity inspection');
    return proof;
  } };
}

// Native Baa-ton captures its own Pi context. Never send a path, UUID, context,
// saved proof, or alternate tool invocation as a way to establish ownership.
export async function requestPiRootIdentity(pi, { signal, timeoutMs = 15000 } = {}) {
  if (typeof pi.events?.emit !== 'function') throw new Error('Native Baa-ton Pi identity bridge unavailable; update Baa-ton for UUID session support');
  if (signal?.aborted) throw new Error('Native Pi identity inspection aborted');
  const responses = [];
  let accepting = true;
  pi.events.emit(CHANNEL, { respond(value) {
    const promise = Promise.resolve(value);
    // Observe every response, including unexpected duplicates/late rejections.
    promise.catch(() => {});
    if (accepting) responses.push(promise);
  } });
  accepting = false;
  if (responses.length !== 1) throw new Error(`Native Baa-ton Pi identity requires exactly one provider; found ${responses.length}. Update/reload the native extension; do not reset roots or retry planning`);
  let timer, abort;
  try {
    return await Promise.race([responses[0], new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Native Pi identity inspection timed out; no proof accepted')), timeoutMs);
      abort = () => reject(new Error('Native Pi identity inspection aborted'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    })]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

export async function assertNativePiIdentity(proof, { agentSession, sessionId, sessionFile, pane, registrationId, root, env }) {
  if (!proof || proof.version !== 1 || proof.source !== 'baa-ton-native-pi' ||
      proof.registrationId !== registrationId || proof.paneId !== pane.paneId || proof.workspaceId !== pane.workspaceId ||
      typeof sessionId !== 'string' || !uuid.test(sessionId) || proof.sessionId !== sessionId ||
      agentSession?.kind !== 'id' || agentSession.value !== sessionId ||
      proof.nativeSession?.kind !== agentSession.kind || proof.nativeSession.value !== agentSession.value ||
      !validSessionPath(proof.checkout) || !validSessionPath(proof.sessionPath) ||
      !await sameSessionPath(proof.sessionPath, sessionFile) ||
      await realpath(proof.checkout) !== root || !(await stat(proof.sessionPath)).isFile() ||
      (env.PI_SESSION_FILE !== undefined && !await sameSessionPath(env.PI_SESSION_FILE, sessionFile)))
    throw new Error('Native Baa-ton Pi identity proof differs from the current registered root, runtime session or Herdr observation; stop without changing ownership');
  return { version: 1, sessionId: proof.sessionId, sessionPath: await realpath(proof.sessionPath) };
}
