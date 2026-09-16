import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');

function runCli(args, options = {}) {
  return new Promise(resolve => {
    execFile(process.execPath, [cli, ...args], options, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

const brief = {
  version: 1,
  objective: 'Improve project',
  acceptance: ['Existing behavior remains covered'],
  tasks: [{ id: 'docs', objective: 'Update docs', files: ['README.md'], checks: ['node --test'] }]
};

test('--help exits 0 and prints usage without reading a brief', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cli help '));
  try {
    const result = await runCli(['--help'], { cwd: dir });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Usage: node cli\.js \[--json\] <brief\.md\|brief\.json>/);
    assert.equal(result.stderr, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('invalid arguments still exit 2', async () => {
  const result = await runCli(['--unknown']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Usage: node cli\.js/);
});

test('CLI preview behavior still renders text and JSON previews', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cli preview '));
  try {
    const filename = path.join(dir, 'brief.json');
    await writeFile(filename, JSON.stringify(brief));

    const text = await runCli([filename]);
    assert.equal(text.code, 0);
    assert.match(text.stdout, /Baa-ton lane preview/);
    assert.match(text.stdout, /docs/);
    assert.equal(text.stderr, '');

    const json = await runCli(['--json', filename]);
    assert.equal(json.code, 0);
    assert.equal(JSON.parse(json.stdout).objective, brief.objective);
    assert.equal(json.stderr, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
