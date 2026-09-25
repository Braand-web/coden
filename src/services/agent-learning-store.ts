/**
 * Persistence for personalisation and the learning layer (tables from
 * migration 20260925090000). Every call is best-effort: a missing table or a
 * Supabase hiccup degrades to "no personalisation / nothing learned", never
 * to a failed run.
 */
import { createHash } from 'node:crypto';
import {
  contributorHash,
  CURATED_KNOWLEDGE,
  rankKnowledge,
  renderKnowledgeContext,
  renderUserMemory,
  setLearnedModelStats,
  type KnowledgeRow,
  type UserMemoryRow,
} from './agent-learning.ts';
import { MAX_USER_INSTRUCTIONS, normalizeInstructions } from './agent-personalization.ts';

type Client = any;
export type AgentPreferences = { instructions: string; shareImprovement: boolean; updatedAt: string | null };

const DEFAULT_PREFERENCES: AgentPreferences = { instructions: '', shareImprovement: true, updatedAt: null };
const PREFERENCES_TTL_MS = 60_000;
const preferencesCache = new Map<string, { at: number; value: AgentPreferences }>();
const memoryCache = new Map<string, { at: number; value: string }>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUserId = (value: unknown) => UUID.test(String(value || ''));

/** Stable across restarts and secret: an explicit salt, else one derived from the service key. */
export function knowledgeSalt(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CODEN_KNOWLEDGE_SALT) return env.CODEN_KNOWLEDGE_SALT;
  return createHash('sha256').update(`coden-knowledge:${env.SUPABASE_SERVICE_ROLE_KEY || 'local'}`).digest('hex');
}

export function contributorFor(userId: string): string {
  return contributorHash(userId, knowledgeSalt());
}

function warn(event: string, error: unknown) {
  const message = String((error as any)?.message || error || '').slice(0, 200);
  console.warn(`[coden:${event}]`, { message });
}

// ─── Preferences ────────────────────────────────────────────────────────────

export async function loadAgentPreferences(client: Client, userId: string, options: { fresh?: boolean } = {}): Promise<AgentPreferences> {
  if (!client || !isUserId(userId)) return { ...DEFAULT_PREFERENCES };
  const cached = preferencesCache.get(userId);
  if (!options.fresh && cached && Date.now() - cached.at < PREFERENCES_TTL_MS) return cached.value;
  try {
    const { data, error } = await client.from('user_agent_preferences').select('instructions,share_improvement,updated_at').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    const value: AgentPreferences = data
      ? { instructions: String(data.instructions || ''), shareImprovement: data.share_improvement !== false, updatedAt: data.updated_at || null }
      : { ...DEFAULT_PREFERENCES };
    preferencesCache.set(userId, { at: Date.now(), value });
    return value;
  } catch (error) {
    warn('agent_preferences_load_failed', error);
    return cached?.value || { ...DEFAULT_PREFERENCES };
  }
}

export class PreferencesValidationError extends Error {}

/**
 * Saves what changed. Turning sharing off takes effect for the very next
 * request (the cache is replaced before returning) and purges what this
 * person already contributed: their knowledge rows are deleted and their past
 * run signals stop counting for the shared router.
 */
export async function saveAgentPreferences(client: Client, userId: string, patch: { instructions?: unknown; shareImprovement?: unknown }): Promise<AgentPreferences & { purged?: number }> {
  if (!client) throw new Error('Personalisation storage is not configured.');
  if (!isUserId(userId)) throw new PreferencesValidationError('Personalisation needs a signed-in account.');
  const current = await loadAgentPreferences(client, userId, { fresh: true });
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  const next: AgentPreferences = { ...current };
  if (patch.instructions !== undefined) {
    const raw = String(patch.instructions ?? '');
    if (raw.trim().length > MAX_USER_INSTRUCTIONS) throw new PreferencesValidationError(`Les instructions sont limitées à ${MAX_USER_INSTRUCTIONS} caractères.`);
    next.instructions = normalizeInstructions(raw);
    row.instructions = next.instructions;
  }
  if (patch.shareImprovement !== undefined) {
    if (typeof patch.shareImprovement !== 'boolean') throw new PreferencesValidationError('shareImprovement must be a boolean.');
    next.shareImprovement = patch.shareImprovement;
    row.share_improvement = patch.shareImprovement;
    if (patch.shareImprovement !== current.shareImprovement) row.share_changed_at = row.updated_at;
  }
  if (row.instructions === undefined) row.instructions = current.instructions;
  if (row.share_improvement === undefined) row.share_improvement = current.shareImprovement;
  const { error } = await client.from('user_agent_preferences').upsert([row], { onConflict: 'user_id' });
  if (error) throw error;
  next.updatedAt = String(row.updated_at);
  preferencesCache.set(userId, { at: Date.now(), value: next });
  let purged: number | undefined;
  if (current.shareImprovement && !next.shareImprovement) purged = await purgeContributions(client, userId);
  return { ...next, ...(purged !== undefined ? { purged } : {}) };
}

export async function purgeContributions(client: Client, userId: string): Promise<number> {
  let purged = 0;
  try {
    const { data, error } = await client.from('agent_knowledge').delete().eq('contributor', contributorFor(userId)).select('id');
    if (error) throw error;
    purged = Array.isArray(data) ? data.length : 0;
  } catch (error) {
    warn('agent_knowledge_purge_failed', error);
  }
  try {
    const { error } = await client.from('agent_quality_signals').update({ shared: false }).eq('user_id', userId).eq('shared', true);
    if (error) throw error;
  } catch (error) {
    warn('agent_signals_unshare_failed', error);
  }
  knowledgeCache = null;
  return purged;
}

// ─── Private memory ─────────────────────────────────────────────────────────

export async function loadUserMemoryBlock(client: Client, userId: string): Promise<string> {
  if (!client || !isUserId(userId)) return '';
  const cached = memoryCache.get(userId);
  if (cached && Date.now() - cached.at < PREFERENCES_TTL_MS) return cached.value;
  try {
    const { data, error } = await client.from('user_agent_memory').select('key,kind,content,weight,updated_at').eq('user_id', userId).order('weight', { ascending: false }).limit(40);
    if (error) throw error;
    const value = renderUserMemory((data || []) as UserMemoryRow[]);
    memoryCache.set(userId, { at: Date.now(), value });
    return value;
  } catch (error) {
    warn('agent_user_memory_load_failed', error);
    return cached?.value || '';
  }
}

/** Reinforces what was observed: an existing key gains weight, a new one starts at its own. */
export async function rememberForUser(client: Client, userId: string, rows: UserMemoryRow[]) {
  if (!client || !isUserId(userId) || !rows.length) return;
  try {
    const keys = rows.map(row => row.key);
    const { data } = await client.from('user_agent_memory').select('key,weight').eq('user_id', userId).in('key', keys);
    const existing = new Map<string, number>((data || []).map((row: any) => [String(row.key), Number(row.weight) || 0]));
    const now = new Date().toISOString();
    const upserts = rows.map(row => ({
      user_id: userId,
      key: row.key.slice(0, 120),
      kind: row.kind,
      content: row.content.slice(0, 300),
      weight: Math.min(50, (existing.get(row.key) || 0) + row.weight),
      updated_at: now,
    }));
    const { error } = await client.from('user_agent_memory').upsert(upserts, { onConflict: 'user_id,key' });
    if (error) throw error;
    memoryCache.delete(userId);
  } catch (error) {
    warn('agent_user_memory_save_failed', error);
  }
}

// ─── Signals and knowledge ──────────────────────────────────────────────────

export type QualitySignal = {
  userId: string;
  projectId?: string | null;
  kind: 'run' | 'error_fixed' | 'retry' | 'feedback' | 'revert';
  taskType?: string;
  modelId?: string | null;
  success?: boolean | null;
  detail?: Record<string, unknown>;
};

/** Content-free facts only: the detail object carries counts and enums, never text. */
export async function recordQualitySignal(client: Client, signal: QualitySignal) {
  if (!client || !isUserId(signal.userId)) return;
  try {
    // Read fresh: another instance may have just recorded an opt-out.
    const preferences = await loadAgentPreferences(client, signal.userId, { fresh: true });
    const { error } = await client.from('agent_quality_signals').insert([{
      user_id: signal.userId,
      project_id: isUserId(signal.projectId) ? signal.projectId : null,
      kind: signal.kind,
      task_type: String(signal.taskType || 'general').slice(0, 40),
      model_id: signal.modelId ? String(signal.modelId).slice(0, 120) : null,
      success: typeof signal.success === 'boolean' ? signal.success : null,
      shared: preferences.shareImprovement,
      detail: signal.detail || {},
    }]);
    if (error) throw error;
  } catch (error) {
    warn('agent_signal_record_failed', error);
  }
}

/** Only for people who share; one row per pattern per contributor. */
export async function contributeKnowledge(client: Client, userId: string, rows: KnowledgeRow[]) {
  if (!client || !isUserId(userId) || !rows.length) return;
  try {
    const preferences = await loadAgentPreferences(client, userId, { fresh: true });
    if (!preferences.shareImprovement) return;
    const contributor = contributorFor(userId);
    const signatures = [...new Set(rows.map(row => row.signature))];
    const { data } = await client.from('agent_knowledge').select('signature').eq('contributor', contributor).in('signature', signatures);
    const known = new Set((data || []).map((row: any) => row.signature));
    const inserts = rows
      .filter(row => !known.has(row.signature))
      .map(row => ({ contributor, kind: row.kind, task_type: row.task_type, signature: row.signature.slice(0, 300), content: row.content.slice(0, 600) }));
    if (!inserts.length) return;
    const { error } = await client.from('agent_knowledge').insert(inserts);
    if (error) throw error;
  } catch (error) {
    warn('agent_knowledge_contribute_failed', error);
  }
}

let knowledgeCache: { at: number; rows: KnowledgeRow[] } | null = null;
const KNOWLEDGE_TTL_MS = 5 * 60_000;

async function knowledgeRows(client: Client): Promise<KnowledgeRow[]> {
  if (knowledgeCache && Date.now() - knowledgeCache.at < KNOWLEDGE_TTL_MS) return knowledgeCache.rows;
  let learned: KnowledgeRow[] = [];
  if (client) {
    try {
      const { data, error } = await client.from('agent_knowledge').select('contributor,kind,task_type,signature,content,created_at').order('created_at', { ascending: false }).limit(3000);
      if (error) throw error;
      learned = (data || []) as KnowledgeRow[];
    } catch (error) {
      warn('agent_knowledge_load_failed', error);
      learned = knowledgeCache?.rows.filter(row => row.contributor) || [];
    }
  }
  knowledgeCache = { at: Date.now(), rows: [...CURATED_KNOWLEDGE, ...learned] };
  return knowledgeCache.rows;
}

/** The shared experience relevant to this request, ready for the prompt ('' when none). */
export async function retrieveKnowledgeContext(client: Client, query: string, options: { taskType?: string; openErrors?: string[]; limit?: number } = {}): Promise<string> {
  try {
    const rows = await knowledgeRows(client);
    return renderKnowledgeContext(rankKnowledge(rows, query, { limit: 5, ...options }));
  } catch (error) {
    warn('agent_knowledge_retrieve_failed', error);
    return '';
  }
}

// ─── Router statistics ──────────────────────────────────────────────────────

export async function refreshModelStats(client: Client) {
  if (!client) return;
  try {
    const { data, error } = await client.rpc('agent_model_success_stats', { window_days: 30 });
    if (error) throw error;
    setLearnedModelStats((data || []) as any[]);
  } catch (error) {
    warn('agent_model_stats_refresh_failed', error);
  }
}
