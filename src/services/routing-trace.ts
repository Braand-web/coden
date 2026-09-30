/**
 * The record of every routing decision.
 *
 * A model choice nobody can look back on cannot be corrected, tuned or
 * A/B-tested — and until now none was kept: the `ai_routing_decisions` table
 * has held zero rows since it was created, its foreign key to a legacy
 * request table making it unwritable from the live path. This writes to
 * `model_routing_events` instead: which model a run started on and why, every
 * switch with the signal that caused it, and one summary per run with its
 * real cost, tokens, cache hits and duration.
 *
 * It holds identifiers, model names, reasons and numbers — never a prompt,
 * a file, an attachment or a preview capture. Writing is fire-and-forget: a
 * failure to record can never fail or slow a generation.
 */

export type RoutingEventKind = 'initial' | 'supervision' | 'fallback' | 'substitution' | 'summary';

export type RoutingTraceEvent = {
  kind: RoutingEventKind;
  runId?: string;
  projectId: string;
  userId: string;
  task: string;
  complexity?: string;
  mode?: string;
  policy?: 'scored' | 'legacy';
  /** The experiment arm the run was assigned to, when one is running. */
  arm?: string;
  fromModel?: string;
  toModel: string;
  reasoningLevel?: string;
  /** What the supervisor saw (no_progress, provider_failure, …). */
  signal?: string;
  /** What it did (escalate_model, switch_family, …). */
  action?: string;
  reason?: string;
  /** The runners-up with their scored parts, for the initial decision. */
  considered?: unknown;
  rejectedCount?: number;
  decisionMs?: number;
  pinned?: boolean;
  // Summary only.
  ok?: boolean;
  costUsd?: number;
  latencyMs?: number;
  promptTokens?: number;
  cachedTokens?: number;
  escalations?: number;
};

type Insert = { from(table: string): { insert(row: Record<string, unknown>): PromiseLike<{ error?: { message?: string } | null }> } };

const clip = (value: unknown, size: number) => (value == null ? null : String(value).slice(0, size));

/** The row a database stores for an event. Exported for tests. */
export function routingRow(event: RoutingTraceEvent): Record<string, unknown> {
  return {
    kind: event.kind,
    run_id: clip(event.runId, 80),
    project_id: event.projectId || null,
    user_id: event.userId || null,
    task: clip(event.task, 40),
    complexity: clip(event.complexity, 20),
    mode: clip(event.mode, 20),
    policy: clip(event.policy, 20),
    arm: clip(event.arm, 20),
    from_model: clip(event.fromModel, 120),
    to_model: clip(event.toModel, 120),
    reasoning_level: clip(event.reasoningLevel, 20),
    signal: clip(event.signal, 40),
    action: clip(event.action, 40),
    reason: clip(event.reason, 500),
    considered: event.considered ?? null,
    rejected_count: Number.isFinite(event.rejectedCount) ? event.rejectedCount : null,
    decision_ms: Number.isFinite(event.decisionMs) ? event.decisionMs : null,
    pinned: event.pinned ?? null,
    ok: event.ok ?? null,
    cost_usd: Number.isFinite(event.costUsd) ? event.costUsd : null,
    latency_ms: Number.isFinite(event.latencyMs) ? Math.round(event.latencyMs!) : null,
    prompt_tokens: Number.isFinite(event.promptTokens) ? Math.round(event.promptTokens!) : null,
    cached_tokens: Number.isFinite(event.cachedTokens) ? Math.round(event.cachedTokens!) : null,
    escalations: Number.isFinite(event.escalations) ? event.escalations : null,
  };
}

/** A writer bound to a database client, or a no-op without one. */
export function createRoutingTraceWriter(client: Insert | null | undefined): (event: RoutingTraceEvent) => void {
  if (!client) return () => undefined;
  return event => {
    try {
      void Promise.resolve(client.from('model_routing_events').insert(routingRow(event))).then(
        result => { if (result?.error) console.warn('[coden:routing_trace_failed]', { message: String(result.error.message || '').slice(0, 160) }); },
        error => console.warn('[coden:routing_trace_failed]', { message: String(error?.message || error).slice(0, 160) }),
      );
    } catch (error: any) {
      console.warn('[coden:routing_trace_failed]', { message: String(error?.message || error).slice(0, 160) });
    }
  };
}

/** Share of prompt tokens the provider served from cache, or null when nothing was reported. */
export function cacheHitRate(promptTokens: number, cachedTokens: number): number | null {
  if (!(promptTokens > 0)) return null;
  return Math.max(0, Math.min(1, cachedTokens / promptTokens));
}
