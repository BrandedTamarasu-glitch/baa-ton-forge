#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const usage = 'Usage: node cli.js [--json] <brief.md|brief.json>';
const args = process.argv.slice(2);
const json = args[0] === '--json';
if (json) args.shift();

async function packageVersion() {
  const packageJson = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  return packageJson.version;
}

if (args.length === 1 && args[0] === '--help') {
  console.log(usage);
} else if (args.length === 1 && args[0] === '--version') {
  console.log(await packageVersion());
} else if (args.length !== 1 || args[0].startsWith('--')) {
  console.error(usage);
  process.exitCode = 2;
} else {
  try {
    const { loadPreview, renderPreview } = await import('./planner.js');
    const preview = await loadPreview(args[0]);
    console.log(json ? JSON.stringify(preview, null, 2) : renderPreview(preview));
  } catch (error) {
    console.error(`Cannot preview brief: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
