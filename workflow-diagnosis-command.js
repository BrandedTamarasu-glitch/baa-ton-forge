import path from 'node:path';
import { diagnoseLane } from './workflow-diagnosis-inspection.js';
import { renderDiagnosis } from './workflow-diagnosis.js';
import { nativeSessionOptions } from './native-pi-identity.js';

export function registerDiagnosis(pi, records) {
  async function inspect(params, ctx, signal) {
    if (!params || Object.keys(params).some(key => !['filename', 'taskId', 'inspectNative'].includes(key)) ||
        typeof params.filename !== 'string' || !params.filename.trim() || /[\r\n\x00]/.test(params.filename) ||
        typeof params.taskId !== 'string' || !/^[a-z][a-z0-9-]*$/.test(params.taskId) ||
        params.inspectNative !== undefined && typeof params.inspectNative !== 'boolean')
      throw new Error('Diagnosis is read-only; provide filename, taskId and optional boolean inspectNative only.');
    return diagnoseLane({ ...params, filename: path.resolve(ctx.cwd, params.filename), cwd: ctx.cwd,
      records: records(ctx), getRecords: () => records(ctx), sessionFile: ctx.sessionManager.getSessionFile(), signal,
      ...(params.inspectNative ? { ...nativeSessionOptions(pi, ctx, signal), exec: pi.exec?.bind(pi) } : {}) });
  }
  pi.registerTool?.({
    name: 'forgeflow_diagnose_lane', label: 'Diagnose selected workflow',
    description: 'Read-only diagnosis for an explicitly selected brief-backed task: explain saved startup/submission/receipt/verification evidence and one supported next step. inspectNative=true requests bounded native identity, child and source inspection and existing guarded startup-retry eligibility checks. Never retries, resumes, dispatches, writes workflow records, scans transcripts or creates resources. Unknown effects remain unresolved.',
    parameters: { type: 'object', properties: { filename: { type: 'string', minLength: 1 }, taskId: { type: 'string', minLength: 1 },
      inspectNative: { type: 'boolean', description: 'Explicit bounded read-only native inspection; defaults to false.' } }, required: ['filename', 'taskId'], additionalProperties: false },
    execute: async (_id, params, signal, _update, ctx) => {
      const report = await inspect(params, ctx, signal);
      return { content: [{ type: 'text', text: renderDiagnosis(report) }], details: report };
    },
  });
  pi.registerCommand('forgeflow-diagnose-lane', {
    description: 'Explain a selected task from saved evidence; add --live for explicit read-only native inspection',
    handler: async (args, ctx) => {
      try {
        const match = /^(?:"([^"\r\n]+)"|([^"\s]+))\s+([a-z][a-z0-9-]*)(?:\s+(--live))?$/.exec(args.trim());
        if (!match || /[\r\n]/.test(args)) throw new Error('Usage: /forgeflow-diagnose-lane "path/to/brief.json" task-id [--live] (one line)');
        const report = await inspect({ filename: match[1] ?? match[2], taskId: match[3], inspectNative: Boolean(match[4]) }, ctx, ctx.signal);
        pi.sendMessage({ customType: 'forgeflow-diagnosis', content: renderDiagnosis(report), details: report, display: true }, { triggerTurn: false });
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); }
    },
  });
}
