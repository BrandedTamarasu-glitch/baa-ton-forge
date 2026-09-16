import path from 'node:path';
import { loadPreview, renderPreview } from './planner.js';

export default function adapter(pi) {
  pi.registerCommand('forgeflow-plan-lanes', {
    description: 'Preview Baa-ton lanes from a Forgeflow brief; never dispatch',
    handler: async (args, ctx) => {
      try {
        let filename = args.trim();
        if (filename.startsWith('"') && filename.endsWith('"')) filename = filename.slice(1, -1);
        if (!filename) throw new Error('Usage: /forgeflow-plan-lanes path/to/brief.md');
        const preview = await loadPreview(path.resolve(ctx.cwd, filename));
        pi.sendMessage({ customType: 'forgeflow-lane-preview', content: renderPreview(preview), display: true, details: preview }, { triggerTurn: false });
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
      }
    },
  });
}
