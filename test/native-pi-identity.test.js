import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nativeFixture } from './native-fixture.js';
import { nativePreflight } from '../preflight.js';
import { requestPiRootIdentity, nativeSessionOptions } from '../native-pi-identity.js';

const id = '01a0b04d-0bef-7207-b486-d51d62f0e3dc';
const env = { HERDR_ENV: '1', HERDR_PANE_ID: 'w4:p7', HERDR_WORKSPACE_ID: 'w4' };
async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'forge-pi-uuid-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = await realpath(base);
  // nativeFixture writes its config/session next to root; keep these inside base.
  const { mkdir } = await import('node:fs/promises');
  const checkout = path.join(root, 'controller'); await mkdir(checkout);
  const native = await nativeFixture({ root: checkout, target: checkout }, env);
  native.responses.agent.agent.agent_session = { kind: 'id', value: id };
  const proof = { version: 1, source: 'baa-ton-native-pi', registrationId: 'registered-root',
    paneId: env.HERDR_PANE_ID, workspaceId: env.HERDR_WORKSPACE_ID,
    checkout, sessionId: id, sessionPath: native.sessionFile, nativeSession: { kind: 'id', value: id } };
  let requests = 0;
  const pi = { events: { emit(channel, request) {
    assert.equal(channel, 'baa-ton:pi-root-identity:v1');
    assert.deepEqual(Object.keys(request), ['respond']);
    requests++; request.respond(Promise.resolve(structuredClone(proof)));
  } } };
  const ctx = { sessionManager: { getSessionId: () => id, getSessionFile: () => native.sessionFile } };
  const options = { prepared: { root: checkout, planArguments: {} }, sessionFile: native.sessionFile,
    ...nativeSessionOptions(pi, ctx), exec: native.exec, env: native.env };
  return { proof, native, ctx, pi, options, requests: () => requests };
}

test('UUID preflight consumes fresh native proof without PI_SESSION_FILE or mutation', async t => {
  const f = await fixture(t), before = await readFile(f.native.configPath);
  const first = await nativePreflight(f.options);
  assert.deepEqual(first.root.sessionIdentity, { version: 1, sessionId: id, sessionPath: f.native.sessionFile });
  assert.deepEqual(await nativePreflight(f.options), first);
  assert.equal(f.requests(), 2, 'saved proof is never reused');
  assert.deepEqual(await readFile(f.native.configPath), before);
  assert.equal(f.native.calls.every(call => call.args.join(' ') === `agent get ${env.HERDR_PANE_ID}`), true);
});

test('missing bridge and conflicting proof block UUID preflight without fallback', async t => {
  const f = await fixture(t);
  await assert.rejects(nativePreflight({ ...f.options, proveSession: undefined }), /fresh native Baa-ton identity proof/);
  const original = structuredClone(f.proof);
  for (const patch of [
    { version: 2 }, { source: 'caller' }, { registrationId: 'another-root' },
    { paneId: 'w4:p8' }, { workspaceId: 'w5' }, { sessionId: 'different' },
    { nativeSession: { kind: 'path', value: f.native.sessionFile } },
    { nativeSession: { kind: 'id', value: 'different' } },
    { checkout: path.dirname(f.proof.checkout) },
    { sessionPath: f.native.sessionFile + '\r' }, { sessionPath: path.join(f.proof.checkout, 'missing.jsonl') },
  ]) {
    Object.assign(f.proof, original, patch);
    await assert.rejects(nativePreflight(f.options), /identity proof differs/);
  }
  Object.assign(f.proof, original);
  await assert.rejects(nativePreflight({ ...f.options, sessionId: 'wrong' }), /identity proof differs/);
  await assert.rejects(nativePreflight({ ...f.options, env: { ...f.options.env, PI_SESSION_FILE: f.native.sessionFile + '\r' } }), /identity proof differs/);
  f.ctx.sessionManager.getSessionId = () => 'changed';
  await assert.rejects(nativePreflight(f.options), /runtime session changed/);
  assert.equal(f.native.calls.every(call => call.args[0] === 'agent'), true);
});

test('bridge rejects unavailable, duplicate, failed, timed-out and aborted providers', async () => {
  await assert.rejects(requestPiRootIdentity({}), /bridge unavailable/);
  await assert.rejects(requestPiRootIdentity({ events: { emit() {} } }), /found 0/);
  await assert.rejects(requestPiRootIdentity({ events: { emit(_channel, request) { request.respond({}); request.respond(Promise.reject(new Error('duplicate'))); } } }), /found 2/);
  await assert.rejects(requestPiRootIdentity({ events: { emit(_channel, request) { request.respond(Promise.reject(new Error('Native proof rejected'))); } } }), /Native proof rejected/);
  const stuck = { events: { emit(_channel, request) { request.respond(new Promise(() => {})); } } };
  await assert.rejects(requestPiRootIdentity(stuck, { timeoutMs: 5 }), /timed out/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(requestPiRootIdentity(stuck, { signal: abort.signal }), /aborted/);
  const during = new AbortController();
  const pending = requestPiRootIdentity(stuck, { signal: during.signal }); during.abort();
  await assert.rejects(pending, /aborted/);
});
