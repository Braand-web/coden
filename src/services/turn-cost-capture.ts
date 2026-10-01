/**
 * Cost capture for agent turns that the billing path never recorded.
 *
 * What a run costs the provider is added to `agent_turns.budget_used.costUsd` as each round ends, whatever becomes of the
 * turn. The usage ledger (`usage_events`) only gets a row when the pipeline comes back with an outcome, so a turn that is
 * cancelled, blocked, times out or throws leaves its spend in the turn and nowhere else. Measured on 2026-10-01: failed
 * turns carried 2.03 $ of the 3.15 $ the turns report, none of it in the ledger.
 *
 * This writes one measurement row per such turn (never a charge: no credits move, no reservation is touched, so no user
 * limit is affected). A turn whose pipeline already wrote its row (it carries `turn_id` in its payload) is skipped, and
 * only turns created after `since` are considered, so rows written before `turn_id` existed are never counted twice.
 * No prompt text and no personal data: ids, a status, counters and an amount.
 */

export const TURN_COST_CAPTURE_VERSION = 'turn-cost-capture.v1';
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'blocked']);

export type CapturableTurn = {
  id: string;
  thread_id: string;
  status: string;
  requested_mode?: string | null;
  budget_used?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string | null;
};

export type CaptureCandidate = {
  turnId: string;
  threadId: string;
  status: string;
  mode: string | null;
  costUsd: number;
  toolCalls: number;
  repairAttempts: number;
  subagents: number;
  at: string;
};

const finite = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** The turns that cost something, ended long enough ago to be final, and are not in the ledger yet. */
export function captureCandidates(
  turns: CapturableTurn[],
  alreadyCaptured: ReadonlySet<string>,
  options: { since: string; now?: Date; settleMs?: number },
): CaptureCandidate[] {
  const now = (options.now || new Date()).getTime();
  const settleMs = options.settleMs ?? 15 * 60_000;
  const since = Date.parse(options.since);
  const candidates: CaptureCandidate[] = [];
  for (const turn of turns) {
    if (!TERMINAL.has(String(turn.status))) continue;
    if (alreadyCaptured.has(turn.id)) continue;
    if (Number.isFinite(since) && Date.parse(turn.created_at) < since) continue;
    const endedAt = Date.parse(turn.updated_at || turn.created_at);
    if (!Number.isFinite(endedAt) || now - endedAt < settleMs) continue;
    const used = turn.budget_used || {};
    const costUsd = Math.max(0, finite(used.costUsd));
    if (costUsd <= 0) continue;
    candidates.push({
      turnId: turn.id,
      threadId: turn.thread_id,
      status: turn.status,
      mode: turn.requested_mode || null,
      costUsd,
      toolCalls: Math.max(0, Math.round(finite(used.toolCalls))),
      repairAttempts: Math.max(0, Math.round(finite(used.repairAttempts))),
      subagents: Math.max(0, Math.round(finite(used.subagents))),
      at: new Date(endedAt).toISOString(),
    });
  }
  return candidates;
}

export type CaptureRowDeps = { fee: (providerCostUsd: number) => number; priceVersion: string };

/** The measurement row for one turn. Identity, outcome and counters only. */
export function captureRow(candidate: CaptureCandidate, accountId: string, deps: CaptureRowDeps) {
  const providerCost = deps.fee(candidate.costUsd);
  return {
    account_id: accountId,
    workspace_id: accountId,
    category: 'build',
    resource: `turn_${candidate.status}`,
    provider: 'openrouter',
    model: 'turn_total',
    quantity: 1,
    unit: 'turn',
    provider_cost_usd: providerCost,
    allocated_platform_cost_usd: 0,
    complete_cost_usd: providerCost,
    price_version_id: deps.priceVersion,
    idempotency_key: `turn:${candidate.turnId}:cost-capture`,
    occurred_at: candidate.at,
    created_at: candidate.at,
    provider_payload: {
      turn_id: candidate.turnId,
      outcome: candidate.status,
      mode: candidate.mode,
      tool_calls: candidate.toolCalls,
      repair_attempts: candidate.repairAttempts,
      subagents: candidate.subagents,
      source: 'agent_turns.budget_used',
      captured_by: TURN_COST_CAPTURE_VERSION,
    },
  };
}

type Client = { from: (table: string) => any };

export type CaptureReport = { scanned: number; candidates: number; captured: number; skippedNoAccount: number; failed: number; usd: number };

/** One pass: read recent terminal turns, write the rows that are missing. Safe to repeat: the key is per turn. */
export async function captureTurnCosts(client: Client, deps: {
  insert: (row: ReturnType<typeof captureRow>) => Promise<unknown>;
  fee: (providerCostUsd: number) => number;
  priceVersion: string;
  since: string;
  now?: Date;
  limit?: number;
}): Promise<CaptureReport> {
  const report: CaptureReport = { scanned: 0, candidates: 0, captured: 0, skippedNoAccount: 0, failed: 0, usd: 0 };
  const turnsResult = await client.from('agent_turns')
    .select('id,thread_id,status,requested_mode,budget_used,created_at,updated_at')
    .in('status', [...TERMINAL])
    .gte('created_at', deps.since)
    .order('created_at', { ascending: false })
    .limit(deps.limit ?? 200);
  if (turnsResult.error) throw new Error(`Turn cost capture could not read turns: ${turnsResult.error.message}`);
  const turns = (turnsResult.data || []) as CapturableTurn[];
  report.scanned = turns.length;
  if (!turns.length) return report;

  const ids = turns.map(turn => turn.id);
  const captured = new Set<string>();
  const existing = await client.from('usage_events').select('provider_payload').in('provider_payload->>turn_id', ids);
  if (existing.error) throw new Error(`Turn cost capture could not read the ledger: ${existing.error.message}`);
  for (const row of (existing.data || []) as Array<{ provider_payload?: { turn_id?: string } }>) {
    if (row.provider_payload?.turn_id) captured.add(String(row.provider_payload.turn_id));
  }

  const candidates = captureCandidates(turns, captured, { since: deps.since, now: deps.now });
  report.candidates = candidates.length;
  if (!candidates.length) return report;

  const threads = await client.from('agent_threads').select('id,organization_id').in('id', [...new Set(candidates.map(candidate => candidate.threadId))]);
  if (threads.error) throw new Error(`Turn cost capture could not read threads: ${threads.error.message}`);
  const organizationOf = new Map(((threads.data || []) as Array<{ id: string; organization_id: string | null }>).map(row => [row.id, row.organization_id]));

  for (const candidate of candidates) {
    const accountId = organizationOf.get(candidate.threadId);
    if (!accountId) { report.skippedNoAccount += 1; continue; }
    try {
      await deps.insert(captureRow(candidate, accountId, { fee: deps.fee, priceVersion: deps.priceVersion }));
      report.captured += 1;
      report.usd += candidate.costUsd;
    } catch (error: any) {
      report.failed += 1;
      console.warn('[coden:turn_cost_capture_failed]', { turn_id: candidate.turnId, message: String(error?.message || error).slice(0, 160) });
    }
  }
  report.usd = Math.round(report.usd * 1e6) / 1e6;
  return report;
}

/** Turns older than this are never captured (the ledger already holds, or lost, their cost). */
export function captureSince(env: Record<string, string | undefined> = process.env, fallback = '2026-10-01T12:00:00Z'): string {
  const raw = String(env.CODEN_COST_CAPTURE_SINCE || '').trim();
  return Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : fallback;
}

export function costCaptureEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.CODEN_COST_CAPTURE ?? '1').trim() !== '0';
}
