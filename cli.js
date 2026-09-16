#!/usr/bin/env node
import { loadPreview, renderPreview } from './planner.js';
const args = process.argv.slice(2);
const json = args[0] === '--json';
if (json) args.shift();
if (args.length !== 1 || args[0].startsWith('--')) {
  console.error('Usage: node cli.js [--json] <brief.md|brief.json>');
  process.exitCode = 2;
} else {
  try {
    const preview = await loadPreview(args[0]);
    console.log(json ? JSON.stringify(preview, null, 2) : renderPreview(preview));
  } catch (error) {
    console.error(`Cannot preview brief: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
