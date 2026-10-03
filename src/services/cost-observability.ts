/** Server-only extension of the usage ledger. No prompts, replies, URLs or email addresses. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomUUID } from 'node:crypto';
import { normalizeRoutingMode, type RoutingMode } from '../lib/routing-mode.ts';

export type CostScope = {
  actorId?: string; projectId?: string; requestId?: string;
  plan?: string; creditTier?: number; billingPeriod?: 'monthly' | 'annual';
  mode?: RoutingMode; selection?: 'auto' | 'explicit';
};
export type ProviderCostObservation = {
  schema_version: 1; event_key: string; occurred_at: string;
  actor_key: string | null; project_key: string | null; task_key: string | null;
  plan: string | null; credit_tier: number | null; billing_period: string | null;
  mode: RoutingMode | null; selection: 'auto' | 'explicit' | null;
  requested_model: string; served_model: string; gateway: 'openrouter'; provider: string | null;
  stage: string | null; prompt_version: string | null; result: 'succeeded' | 'failed' | 'cancelled';
  latency_ms: number; input_tokens: number | null; output_tokens: number | null;
  cached_read_tokens: number | null; cached_write_tokens: number | null; reasoning_tokens: number | null;
  cost_usd: number | null; cost_source: 'gateway' | 'estimated' | 'unknown';
};
export type ObservationInput = {
  eventKey?: string; requestedModel: string; servedModel?: string; provider?: unknown;
  metadata?: Record<string, unknown>; result: ProviderCostObservation['result']; latencyMs: number;
  usage?: Record<string, any>; estimatedCostUsd?: number;
};
const scopes = new AsyncLocalStorage<CostScope>();
export function runWithCostScope<T>(scope: CostScope, fn: () => T): T { return scopes.run(scope, fn); }
/** Resolved server context only. Never changes routing or billing decisions. */
export function enrichCostScope(value: Partial<CostScope>) {
  if (process.env.CODEN_COST_OBSERVABILITY_V1 !== '1') return;
  const scope = scopes.getStore();
  if (scope) Object.assign(scope, value);
}
const amount = (value: unknown): number | null => (typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0 ? null : Number(value);
const tokens = (value: unknown) => { const n = amount(value); return n === null ? null : Math.floor(n); };
const identifier = (value: unknown): string | null => typeof value === 'string' && /^[a-z0-9][a-z0-9_.:/-]{0,159}$/i.test(value) ? value : null;
const planNames = new Set(['free','pro','pro_plus','business','enterprise']);
const stages = new Set(['classification','conversation','summary','planning','code_generation','code_edit','debug','review','architecture','security','design','research','vision','orchestrator','exploration','front','back','qa','evaluator']);
// Only version labels emitted by Coden, never arbitrary metadata text.
const promptVersion = (value: unknown): string | null => typeof value === 'string' && /^(?:v\d+(?:\.\d+){0,3}|coden-(?:agent-prompt-stack|universal-builder-prompt|message-streaming-prompt|auto-infrastructure-prompt)-v\d+)$/.test(value) ? value : null;
export function pseudonymizeCostId(value: string | undefined, secret: string): string | null {
  return value && secret ? createHmac('sha256', secret).update(`coden-cost-v1\0${value}`).digest('hex') : null;
}
export function normalizeProviderObservation(input: ObservationInput, scope: CostScope, secret: string): ProviderCostObservation {
  const usage = input.usage || {};
  const reported = amount(usage.cost);
  const estimated = amount(input.estimatedCostUsd);
  const output = tokens(usage.completion_tokens);
  const reasoning = tokens(usage.completion_tokens_details?.reasoning_tokens);
  // OpenRouter includes reasoning in output tokens. Never add it a second time.
  const stage = String(input.metadata?.task || '');
  return {
    schema_version: 1, event_key: input.eventKey || randomUUID(), occurred_at: new Date().toISOString(),
    actor_key: pseudonymizeCostId(scope.actorId, secret), project_key: pseudonymizeCostId(scope.projectId, secret), task_key: pseudonymizeCostId(scope.requestId, secret),
    plan: planNames.has(String(scope.plan)) ? String(scope.plan) : null,
    credit_tier: amount(scope.creditTier), billing_period: ['monthly','annual'].includes(String(scope.billingPeriod)) ? scope.billingPeriod! : null,
    mode: scope.mode ? normalizeRoutingMode(scope.mode) : null, selection: scope.selection || null,
    requested_model: identifier(input.requestedModel) || 'unknown', served_model: identifier(input.servedModel || input.requestedModel) || 'unknown', gateway: 'openrouter', provider: identifier(input.provider),
    stage: stages.has(stage) ? stage : null, prompt_version: promptVersion(input.metadata?.prompt_version), result: input.result,
    latency_ms: Number.isFinite(input.latencyMs) ? Math.max(0, Math.floor(input.latencyMs)) : 0, input_tokens: tokens(usage.prompt_tokens), output_tokens: output,
    cached_read_tokens: tokens(usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached),
    cached_write_tokens: tokens(usage.prompt_tokens_details?.cache_write_tokens),
    reasoning_tokens: reasoning === null ? null : output === null ? reasoning : Math.min(output, reasoning),
    cost_usd: reported ?? estimated, cost_source: reported !== null ? 'gateway' : estimated !== null ? 'estimated' : 'unknown',
  };
}

type Sink = (batch: ProviderCostObservation[]) => Promise<void>;
/** Bounded asynchronous writer, idempotent event keys, visible failures; never blocks inference. */
export class CostObservationWriter {
  private pending: ProviderCostObservation[] = [];
  private writing = false;
  private scheduled = false;
  readonly health = { persisted: 0, dropped: 0, failures: 0 };
  constructor(private sink: Sink, private maxPending = 1000) {}
  enqueue(event: ProviderCostObservation) {
    if (this.pending.length >= this.maxPending) { this.health.dropped += 1; return; }
    this.pending.push(event);
    if (!this.scheduled && !this.writing) { this.scheduled = true; setImmediate(() => { this.scheduled = false; void this.flush(); }); }
  }
  async flush() {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.pending.length) {
        const batch = this.pending.splice(0, 100);
        let persisted = false;
        for (let retry = 0; retry < 3; retry++) {
          try { await this.sink(batch); persisted = true; break; }
          catch {
            this.health.failures += 1;
            if (retry < 2) await new Promise(resolve => setTimeout(resolve, 50 * 2 ** retry));
          }
        }
        if (persisted) this.health.persisted += batch.length;
        else this.health.dropped += batch.length;
      }
    } finally { this.writing = false; }
  }
  snapshot() { return { ...this.health, pending: this.pending.length, writing: this.writing }; }
}
let writer: CostObservationWriter | null = null;
export function configureCostObservationWriter(sink: Sink) { writer = new CostObservationWriter(sink); }
export function costObservationHealth() { return writer?.snapshot() || { configured: false }; }
export function observeProviderCost(input: ObservationInput) {
  if (process.env.CODEN_COST_OBSERVABILITY_V1 !== '1' || !writer || !process.env.CODEN_SECRETS_KEY) return;
  try { writer.enqueue(normalizeProviderObservation(input, scopes.getStore() || {}, process.env.CODEN_SECRETS_KEY)); }
  catch { /* Measurement never changes the returned result or billing. */ }
}
