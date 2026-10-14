import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REA_GUIDANCE, REA_LIMITS, REA_TOOL_SCHEMAS, reaRelativePath } from './policy.ts';
import { connectRea } from './client.ts';
import { snapshotReaArtifact } from './snapshot.ts';
import { redactSecrets } from '../secret-redaction.ts';
import type { ReaClient, ReaTools } from './contracts.ts';

function payload(raw: any): any {
  if (raw?.isError) throw new Error('REA_ANALYSIS_FAILED');
  const value = raw?.structuredContent ?? JSON.parse(raw?.content?.find((item: any) => item.type === 'text')?.text || 'null');
  if (value?.error || value?.ok === false) throw new Error('REA_ANALYSIS_FAILED');
  const result = value?.result ?? value;
  if (!result || result.error || result.ok === false) throw new Error('REA_ANALYSIS_FAILED');
  return result;
}
function evidenceIds(value: unknown, ids: Set<string>) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'evidence_id' || key === 'parent_evidence_id') && typeof child === 'string' && /^ev_[a-f0-9]{64}$/.test(child)) ids.add(child);
    else if (child && typeof child === 'object') evidenceIds(child, ids);
  }
}
export function createBuilderReaTools(input: {
  projectId: string; userId: string; sandbox: { projectId: string; dir: string };
  signal?: AbortSignal; deadline?: number; redact?: (value: string) => string;
  connect?: typeof connectRea; enabled?: boolean;
}): ReaTools | undefined {
  if (input.enabled === false || process.env.CODEN_REA_ENABLED === 'false') return undefined;
  if (!input.userId || !input.projectId || input.sandbox.projectId !== input.projectId) throw new Error('REA_SCOPE_DENIED');
  let root: string | undefined, client: ReaClient | undefined, disposed = false;
  let analyses = 0, calls = 0;
  const ids = new Set<string>();
  const cached = new Map<string, unknown>();
  let serial: Promise<unknown> = Promise.resolve();
  const dispose = async () => {
    disposed = true;
    await client?.close().catch(() => {}); client = undefined;
    // The service owns this unique directory, never a caller-supplied project path.
    if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
    ids.clear();
    cached.clear();
  };
  const ensure = async () => {
    if (disposed) throw new Error('REA_SESSION_CLOSED');
    if (!root) root = await mkdtemp(path.join(tmpdir(), 'coden-rea-'));
    if (!client) client = await (input.connect || connectRea)(root, input.signal);
    return client;
  };
  const scrub = (value: unknown): unknown => {
    if (typeof value === 'string') {
      let text = value;
      if (root) text = text.replaceAll(root, '[analysis]').replaceAll(root.replaceAll('\\', '/'), '[analysis]');
      text = text.replaceAll(input.sandbox.dir, '[project]').replaceAll(input.sandbox.dir.replaceAll('\\', '/'), '[project]');
      return (input.redact || redactSecrets)(redactSecrets(text));
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, scrub(child)]));
    return value;
  };
  const invoke = async (name: string, args: Record<string, unknown>) => {
    input.signal?.throwIfAborted();
    if (disposed) throw new Error('REA_SESSION_CLOSED');
    if (!REA_TOOL_SCHEMAS.some(tool => tool.name === name)) throw new Error('REA_TOOL_UNAVAILABLE');
    if (++calls > REA_LIMITS.calls) throw new Error('REA_CALL_LIMIT');
    const remaining = Math.min(REA_LIMITS.timeoutMs, (input.deadline || Infinity) - Date.now());
    if (remaining < 1000) throw new Error('REA_TIMEOUT');
    const start = Date.now();
    let selection: unknown;
    if (name === 'rea_inspect_artifact' || name === 'rea_analyze_javascript') reaRelativePath(args.path);
    else if (typeof args.evidence_id !== 'string' || !ids.has(args.evidence_id)) throw new Error('REA_EVIDENCE_NOT_IN_RUN');
    const c = await ensure();
    const call = async (tool: string, values: Record<string, unknown>) => payload(await c.callTool({ name: tool, arguments: values }, { signal: input.signal, timeout: Math.min(remaining, Math.max(1, remaining - (Date.now() - start))) }));
    let result: any;
    if (name === 'rea_inspect_artifact' || name === 'rea_analyze_javascript') {
      if (++analyses > REA_LIMITS.analyses) throw new Error('REA_ANALYSIS_LIMIT');
      const snapshot = await snapshotReaArtifact(input.sandbox.dir, args.path, path.join(root!, `artifact-${analyses}`));
      selection = { path: snapshot.selectedPath, sha256: snapshot.sha256, files: snapshot.files, bytes: snapshot.bytes, excludedFiles: snapshot.excludedFiles, reused: cached.has(snapshot.sha256), scope: 'selected non-secret project files only' };
      // REA's directory/ASAR route produces inventory and static JS evidence.
      // Its native open_binary route does not accept an ordinary directory.
      result = cached.get(snapshot.sha256);
      if (!result) {
        result = await call('analyze_javascript_application', { input_path: snapshot.inputPath, detail: 'summary', max_heap_mb: REA_LIMITS.heapMb, analysis_timeout_ms: Math.min(20_000, remaining) });
        cached.set(snapshot.sha256, result);
      }
    } else {
      if (typeof args.evidence_id !== 'string' || !ids.has(args.evidence_id)) throw new Error('REA_EVIDENCE_NOT_IN_RUN');
      const reference = { kind: 'retained-evidence', evidence_id: args.evidence_id };
      if (name === 'rea_read_analysis') {
        if (!['summary', 'modules'].includes(String(args.view))) throw new Error('REA_VIEW_INVALID');
        const offset = args.offset ?? 0;
        if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 10_000) throw new Error('REA_VIEW_INVALID');
        result = await call('inspect_analysis_view', { source: reference, view: args.view === 'modules' ? { kind: 'page', collection: 'modules', offset, limit: 12 } : { kind: 'summary' } });
      } else {
        if (!['node-id', 'route', 'string', 'api', 'channel', 'module'].includes(String(args.kind)) || typeof args.value !== 'string' || !args.value || args.value.length > 240 || !['incoming', 'outgoing'].includes(String(args.direction))) throw new Error('REA_SEED_INVALID');
        result = await call('trace_application_feature', { application: reference, seed: { kind: args.kind, value: args.value, match: 'exact', case_sensitive: false }, direction: args.direction });
      }
    }
    evidenceIds(result, ids);
    const safe = scrub(result);
    const serialized = JSON.stringify(safe);
    return { ok: true, tool: name, durationMs: Date.now() - start, selection, evidenceIds: [...ids],
      delivery: serialized.length > REA_LIMITS.outputChars ? 'partial' : 'complete',
      result: serialized.length > REA_LIMITS.outputChars ? undefined : safe,
      preview: serialized.length > REA_LIMITS.outputChars ? serialized.slice(0, REA_LIMITS.outputChars) : undefined,
      hint: serialized.length > REA_LIMITS.outputChars ? 'Delivery is incomplete. Reuse the evidence ID to request a summary or module page; do not repeat the analysis.' : undefined };
  };
  return {
    schemas: REA_TOOL_SCHEMAS, guidance: REA_GUIDANCE,
    call(name, args) {
      const next = serial.then(async () => {
        try { return await invoke(name, args); }
        catch (error: any) {
          if (input.signal?.aborted) { await dispose(); input.signal.throwIfAborted(); }
          const code = /^REA_[A-Z_]+$/.test(error?.message || '') ? error.message : 'REA_UNAVAILABLE';
          if (code === 'REA_UNAVAILABLE' || code === 'REA_TIMEOUT') await dispose();
          return { ok: false, error: code, hint: 'Use ordinary project tools or a narrower owned artifact. Do not repeatedly retry.' };
        }
      });
      serial = next.catch(() => {});
      return next;
    },
    dispose: async () => { disposed = true; await serial.catch(() => {}); await dispose(); },
  };
}
