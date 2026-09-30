/**
 * Persistence and reading for the action guard: the decision journal, the
 * rules people set, and the summary the admin reads. Every call is
 * best-effort — a missing table means an empty journal, never a failed run.
 */
import type { GuardJournalEntry } from './action-guard.ts';

type Client = any;

const warned = new Set<string>();
function warnOnce(event: string, error: unknown) {
  if (warned.has(event)) return;
  warned.add(event);
  console.warn(`[coden:${event}]`, { message: String((error as any)?.message || error || '').slice(0, 160) });
}

/** A journal that batches: one insert per half second at most, dropped rather than allowed to pile up. */
export function createGuardJournal(client: Client | null, options: { flushMs?: number; maxQueue?: number } = {}) {
  const queue: GuardJournalEntry[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    timer = null;
    const batch = queue.splice(0, queue.length);
    if (!batch.length || !client) return;
    try {
      const { error } = await client.from('action_guard_events').insert(batch.map(entry => ({
        created_at: entry.at, run_id: entry.runId ?? null, project_id: entry.projectId || null, user_id: entry.userId || null, tool: entry.tool, category: entry.category,
        tier: entry.tier, decision: entry.decision, stage: entry.stage, rule: entry.rule ?? null, reason: entry.reason.slice(0, 400), latency_ms: Math.round(entry.latencyMs * 100) / 100,
        cached: entry.cached, mode: entry.mode, shadow_decision: entry.shadowDecision ?? null, actor: entry.actor, summary: entry.summary,
      })));
      if (error) throw error;
    } catch (error) { warnOnce('action_guard_journal_failed', error); }
  };
  return {
    write(entry: GuardJournalEntry) {
      // Allowed reads are by far the most numerous and say the least; they are counted in the run's summary, not stored.
      if (entry.decision === 'allow' && entry.tier === 1 && !entry.shadowDecision) return;
      if (queue.length >= (options.maxQueue ?? 500)) return;
      queue.push(entry);
      if (!timer) { timer = setTimeout(() => void flush(), options.flushMs ?? 500); timer.unref?.(); }
    },
    flush,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RULES_TTL_MS = 30_000;
const rulesCache = new Map<string, { at: number; rules: string[] }>();

/** Lines from the person's own instructions that read as rules about what the agent may do. */
export function rulesFromInstructions(instructions: string): string[] {
  return String(instructions || '')
    .split(/\n|(?<=[.!?])\s+/)
    .map(line => line.trim())
    .filter(line => line.length >= 8 && line.length <= 300 && /(?:jamais|never|toujours (?:me )?demander|always ask|sans (?:me )?(?:demander|pr[ée]venir)|without asking|ne (?:touche|modifie|d[ée]ploie|supprime|envoie)[a-z]* pas|do not (?:touch|deploy|change|delete|send)|don['’]t (?:touch|deploy|change|delete|send))/i.test(line))
    .slice(0, 8);
}

export async function loadGuardRules(client: Client | null, userId: string, projectId: string, instructions = ''): Promise<string[]> {
  const fromInstructions = rulesFromInstructions(instructions);
  if (!client || !UUID.test(userId)) return fromInstructions;
  const key = `${userId}:${projectId}`;
  const cached = rulesCache.get(key);
  if (cached && Date.now() - cached.at < RULES_TTL_MS) return [...cached.rules, ...fromInstructions];
  try {
    const { data, error } = await client.from('agent_guard_rules').select('rule,project_id').eq('user_id', userId).order('created_at', { ascending: true }).limit(60);
    if (error) throw error;
    const rules = (data || []).filter((row: any) => !row.project_id || row.project_id === projectId).map((row: any) => String(row.rule)).slice(0, 20);
    // Nothing accumulates: entries past their lifetime are dropped as new ones arrive, and the map has a ceiling.
    for (const [cachedKey, entry] of rulesCache) if (Date.now() - entry.at > RULES_TTL_MS * 4) rulesCache.delete(cachedKey);
    if (rulesCache.size >= 2_000) rulesCache.delete(rulesCache.keys().next().value as string);
    rulesCache.set(key, { at: Date.now(), rules });
    return [...rules, ...fromInstructions];
  } catch (error) {
    warnOnce('action_guard_rules_failed', error);
    return fromInstructions;
  }
}

export function invalidateGuardRules(userId: string) {
  for (const key of rulesCache.keys()) if (key.startsWith(`${userId}:`)) rulesCache.delete(key);
}

export type GuardEventRow = { decision: string; category: string; stage: string; tool: string; latency_ms: number | null; shadow_decision: string | null; label: string | null; created_at?: string; reason?: string | null; rule?: string | null; summary?: string | null; id?: string; mode?: string | null; actor?: string | null };

const percentile = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] : null;
const round = (value: number | null) => value === null ? null : Math.round(value * 100) / 100;

/** What the admin reads: how often the guard stopped or asked, where, how fast, and what people said about it. */
export function summarizeGuardEvents(rows: GuardEventRow[]) {
  const count = (key: (row: GuardEventRow) => string) => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(key(row), (map.get(key(row)) || 0) + 1);
    return [...map.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  };
  const model = rows.filter(row => row.stage === 'model' && row.latency_ms != null).map(row => Number(row.latency_ms));
  const fast = rows.filter(row => row.stage !== 'model' && row.latency_ms != null).map(row => Number(row.latency_ms));
  const shadow = rows.filter(row => row.shadow_decision);
  return {
    total: rows.length,
    byDecision: count(row => row.decision),
    byCategory: count(row => `${row.category}:${row.decision}`),
    byStage: count(row => row.stage),
    byRule: count(row => row.rule || '—').filter(entry => entry.name !== '—').slice(0, 12),
    latency: { fastP95Ms: round(percentile(fast, 0.95)), modelP50Ms: round(percentile(model, 0.5)), modelP95Ms: round(percentile(model, 0.95)) },
    /** The judge in shadow: how often it would have decided differently from what was applied. */
    shadowDisagreement: shadow.length ? Math.round(shadow.filter(row => row.shadow_decision !== row.decision).length / shadow.length * 100) / 100 : null,
    labelled: { ok: rows.filter(row => row.label === 'ok').length, falsePositives: rows.filter(row => row.label === 'false_positive').length, falseNegatives: rows.filter(row => row.label === 'false_negative').length },
  };
}
