#!/usr/bin/env node
import { checkInstallation, renderInstallation } from './installation.js';

const usage = 'Usage: node check-install.js [--project PATH] [--agent-dir PATH] [--json]';
const args = process.argv.slice(2);
const options = {};
let json = false;
if (args.length === 1 && args[0] === '--help') {
  console.log(usage);
} else {
  try {
    while (args.length) {
      const flag = args.shift();
      if (flag === '--json' && !json) json = true;
      else if (['--project', '--agent-dir'].includes(flag) && args[0] && !args[0].startsWith('--')) {
        const key = flag === '--project' ? 'project' : 'agentDir';
        if (options[key]) throw new Error(usage);
        options[key] = args.shift();
      } else throw new Error(usage);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
  if (!process.exitCode) {
    try {
      const report = await checkInstallation(options);
      console.log(json ? JSON.stringify(report, null, 2) : renderInstallation(report));
      if (!report.ok) process.exitCode = 1;
    } catch (error) {
      console.error(`Cannot check installation: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
