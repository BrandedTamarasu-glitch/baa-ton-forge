import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { checkStartupRetry } from '../dispatch-retry.js';
import { startupRetryFixture as fixture, git } from './fixtures/startup-retry.js';

test('read-only startup retry proves original child, profile, scope and saved attempt', async t => {
  const f = await fixture(t), before = await readFile(f.manifestPath);
  const result = await checkStartupRetry(f.options);
  assert.equal(result.mode, 'startup-retry');
  assert.equal(result.readiness.evidence.retryOf, 'initial');
  assert.equal(result.readiness.evidence.child.sessionId, 'child-session');
  assert.deepEqual(await readFile(f.manifestPath), before);
  assert.equal(git(f.target, 'status', '--porcelain'), '');
});

test('prompt attempts, receipts, wrong stage, changed scope and foreign owner block retry', async t => {
  const f = await fixture(t), baseline = structuredClone(f.flow);
  for (const alter of [
    w => { w.lanes[0].promptAttemptedAt = 'time'; }, w => { w.lanes[0].promptedAt = 'time'; },
    w => { w.lanes[0].completionReceipt = { id: 'receipt' }; }, w => { w.retry.failedStage = 'prompt'; },
    w => { w.lanes[0].launchProfile.model = 'different'; }, w => { w.taskBinding.rootSessionPath = '/foreign'; },
    w => { w.lanes[0].objective = 'different'; }, w => { w.ownership.paneIds = []; },
    w => { w.status = 'running'; }, w => { w.lanes.push(structuredClone(w.lanes[0])); },
  ]) {
    Object.keys(f.flow).forEach(key => delete f.flow[key]); Object.assign(f.flow, structuredClone(baseline)); alter(f.flow); await f.save();
    await assert.rejects(checkStartupRetry(f.options));
  }
});

test('busy/replaced child and missing or mismatched original attestation cannot authorize retry', async t => {
  const f = await fixture(t), baseline = structuredClone(f.agent);
  for (const alter of [a => { a.agent_status = 'working'; }, a => { a.interactive_ready = false; },
    a => { a.agent_session.value = 'replacement'; }, a => { a.launch_pending = true; }, a => { a.workspace_id = 'foreign'; }]) {
    Object.keys(f.agent).forEach(key => delete f.agent[key]); Object.assign(f.agent, structuredClone(baseline)); alter(f.agent);
    await assert.rejects(checkStartupRetry(f.options), /Existing child/);
  }
  Object.keys(f.agent).forEach(key => delete f.agent[key]); Object.assign(f.agent, baseline);
  await writeFile(f.startup+'.ready', JSON.stringify({ ...f.ready, nonce: 'wrong' }));
  await assert.rejects(checkStartupRetry(f.options), /attestation/);
  await rm(f.startup+'.ready'); await assert.rejects(checkStartupRetry(f.options), /ENOENT/);
});

test('unknown results, foreign session and dirty checkout remain blocked', async t => {
  const f = await fixture(t);
  await assert.rejects(checkStartupRetry({ ...f.options, sessionFile: '/foreign' }), /owning/);
  const result = f.options.records.at(-1); result.outcome = 'unknown';
  await assert.rejects(checkStartupRetry(f.options), /saved agent_not_ready/);
  result.outcome = 'error';
  await writeFile(path.join(f.target, 'file.txt'), 'unexpected work');
  await assert.rejects(checkStartupRetry(f.options), /dirty/);
});
