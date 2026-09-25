/**
 * The shared library and the error memory, stored on the server.
 *
 * A run opens a `LibrarySession`: it retrieves the skills, the reusable
 * sub-agents and the error rules that fit the task (semantic search), then
 * collects what the run creates and the errors it meets. When the run ends,
 * `settle` records the outcome: only a run that succeeded (validation passed,
 * not cancelled) promotes what it created, and only for a user who shares.
 *
 * Every call degrades to "nothing learnt" on a database hiccup: the library
 * can make a run better, never make it fail.
 */
import { resolveEmbeddingProvider, type EmbeddingProvider, type EmbeddingVector } from '../embeddings.ts';
import { fixCategory } from '../agent-learning.ts';
import {
  embeddingText,
  findEquivalent,
  libraryRejection,
  rankLibrary,
  renderAgents,
  renderSkills,
  shouldAutoDisable,
  slugify,
  type AgentDefinition,
  type LibraryItem,
  type LibraryKind,
  type SkillDefinition,
} from './library.ts';
import {
  memorySignature,
  observe,
  rankMemories,
  renderErrorRules,
  ruleText,
  sanitizeObservation,
  type ErrorMemory,
  type ErrorObservation,
} from './error-memory.ts';

type Client = any;

export type LibraryCandidate = {
  kind: LibraryKind;
  name: string;
  description: string;
  definition: AgentDefinition | SkillDefinition;
  tags: string[];
  /** The library item this one improves (a new version of it). */
  improves?: string | null;
  /** For an agent: whether its own task succeeded. */
  succeeded?: boolean;
};

export type LibrarySession = {
  requestId: string;
  /** Salted hash of the user, or null when the user does not share. */
  contributor: string | null;
  shareAllowed: boolean;
  projectLibraries: Record<string, number>;
  injectedRuleIds: Set<string>;
  usedItemIds: Set<string>;
  /** A reused sub-agent is judged on its own task, not on the whole run. */
  itemOutcomes: Map<string, boolean>;
  candidates: LibraryCandidate[];
  errors: ErrorObservation[];
  /** Agents from the library, by id, for delegation. */
  agents: Map<string, LibraryItem>;
};

export type Retrieval = { block: string; skills: LibraryItem[]; agents: LibraryItem[]; rules: ErrorMemory[] };

/** Turns observations into generic cause / fix / rule (and a generic message for a user's correction). */
export type ErrorSummarizer = (observations: ErrorObservation[]) => Promise<Array<Partial<Pick<ErrorObservation, 'message' | 'cause' | 'fix' | 'rule'>>>>;

const CACHE_MS = 90_000;
const nowIso = () => new Date().toISOString();

function warn(event: string, error: unknown) {
  console.warn(`[coden:${event}]`, { message: String((error as any)?.message || error || '').slice(0, 200) });
}

export function openLibrarySession(input: { requestId: string; contributor: string | null; shareAllowed: boolean; projectLibraries: Record<string, number> }): LibrarySession {
  return {
    requestId: input.requestId,
    contributor: input.shareAllowed ? input.contributor : null,
    shareAllowed: input.shareAllowed,
    projectLibraries: input.projectLibraries,
    injectedRuleIds: new Set(),
    usedItemIds: new Set(),
    itemOutcomes: new Map(),
    candidates: [],
    errors: [],
    agents: new Map(),
  };
}

export class AgentLibraryStore {
  private items: { at: number; rows: LibraryItem[] } | null = null;
  private memories: { at: number; rows: ErrorMemory[] } | null = null;
  readonly embedder: EmbeddingProvider;

  constructor(private readonly client: Client, embedder?: EmbeddingProvider) {
    this.embedder = embedder || resolveEmbeddingProvider(process.env as Record<string, string | undefined>);
  }

  invalidate() { this.items = null; this.memories = null; }

  private async embed(texts: string[]): Promise<EmbeddingVector[]> {
    if (!texts.length) return [];
    try { return await this.embedder.embed(texts); } catch (error) { warn('library_embed_failed', error); return texts.map(() => []); }
  }

  /** Rows whose vector is missing or from another provider get one, saved in the background. */
  private async withEmbeddings<T extends { id: string; embedding: EmbeddingVector | null }>(rows: T[], text: (row: T) => string, table: string): Promise<T[]> {
    const stale = rows.filter(row => !Array.isArray(row.embedding) || row.embedding.length !== this.embedder.dimensions);
    if (!stale.length) return rows;
    const vectors = await this.embed(stale.map(text));
    stale.forEach((row, index) => { row.embedding = vectors[index]?.length ? vectors[index] : null; });
    void Promise.all(stale.filter(row => row.embedding).map(row => this.client.from(table).update({ embedding: row.embedding }).eq('id', row.id))).catch(error => warn('library_embedding_save_failed', error));
    return rows;
  }

  async loadItems(fresh = false): Promise<LibraryItem[]> {
    if (!this.client) return [];
    if (!fresh && this.items && Date.now() - this.items.at < CACHE_MS) return this.items.rows;
    try {
      const { data, error } = await this.client.from('agent_library_items').select('*').eq('is_latest', true).neq('status', 'archived').limit(2000);
      if (error) throw error;
      const rows = await this.withEmbeddings((data || []) as LibraryItem[], embeddingText, 'agent_library_items');
      this.items = { at: Date.now(), rows };
      return rows;
    } catch (error) {
      warn('library_load_failed', error);
      return this.items?.rows || [];
    }
  }

  async loadMemories(fresh = false): Promise<ErrorMemory[]> {
    if (!this.client) return [];
    if (!fresh && this.memories && Date.now() - this.memories.at < CACHE_MS) return this.memories.rows;
    try {
      const { data, error } = await this.client.from('agent_error_memory').select('*').neq('status', 'disabled').limit(3000);
      if (error) throw error;
      const rows = await this.withEmbeddings((data || []) as ErrorMemory[], row => `${row.error_message}\n${row.cause}\n${row.rule}\n${Object.keys(row.context?.libraries || {}).join(' ')}`, 'agent_error_memory');
      this.memories = { at: Date.now(), rows };
      return rows;
    } catch (error) {
      warn('error_memory_load_failed', error);
      return this.memories?.rows || [];
    }
  }

  /**
   * What the library holds for this task: skills and agents by meaning,
   * error rules for the project's stack and the task. Read before any code
   * is written, for the master agent and every sub-agent.
   */
  async retrieve(session: LibrarySession, task: string, options: { skills?: number; agents?: number; rules?: number } = {}): Promise<Retrieval> {
    const [items, memories] = await Promise.all([this.loadItems(), this.loadMemories()]);
    const [query] = await this.embed([task.slice(0, 4_000)]);
    const skillRanks = query?.length ? rankLibrary(items, query, { kind: 'skill', limit: options.skills ?? 3, minSimilarity: 0.25 }) : [];
    const agentRanks = query?.length ? rankLibrary(items, query, { kind: 'agent', limit: options.agents ?? 6, minSimilarity: 0.15 }) : [];
    const rules = rankMemories(memories, query?.length ? query : null, session.projectLibraries, options.rules ?? 8);

    const skills = skillRanks.map(entry => entry.item);
    const agents = agentRanks.map(entry => entry.item);
    skills.forEach(item => session.usedItemIds.add(item.id));
    agents.forEach(item => session.agents.set(item.id, item));
    rules.forEach(entry => session.injectedRuleIds.add(entry.memory.id));

    // Permanent rules tied to a skill are shown inside it, as its pitfalls.
    const pitfalls = new Map<string, string[]>();
    for (const memory of memories) {
      if (memory.permanent && memory.skill_id && memory.status === 'active') pitfalls.set(memory.skill_id, [...(pitfalls.get(memory.skill_id) || []), ruleText(memory)]);
    }
    const block = [
      renderErrorRules(rules),
      renderSkills(skills.map(item => ({ item, pitfalls: pitfalls.get(item.id) }))),
      renderAgents(agents),
    ].filter(Boolean).join('\n\n');
    return { block, skills, agents, rules: rules.map(entry => entry.memory) };
  }

  /** A library agent, by id, when the master reuses one. */
  async agent(id: string): Promise<LibraryItem | null> {
    const items = await this.loadItems();
    return items.find(item => item.id === id && item.kind === 'agent' && item.status === 'active') || null;
  }

  /**
   * The run is over. Counts usage, promotes what the run created (success
   * only, sharing only), records the errors, switches off what keeps failing.
   */
  async settle(session: LibrarySession, outcome: { success: boolean; cancelled: boolean }, summarize?: ErrorSummarizer): Promise<{ promoted: number; versions: number; merged: number; errors: number; disabled: number }> {
    const report = { promoted: 0, versions: 0, merged: 0, errors: 0, disabled: 0 };
    if (!this.client) return report;
    try {
      report.disabled = await this.recordUsage(session, outcome);
      if (outcome.success && !outcome.cancelled && session.shareAllowed) {
        const promoted = await this.promote(session);
        report.promoted = promoted.created;
        report.versions = promoted.versions;
        report.merged = promoted.merged;
      }
      if (session.shareAllowed && session.errors.length) report.errors = await this.recordErrors(session, outcome, summarize);
    } catch (error) {
      warn('library_settle_failed', error);
    } finally {
      this.invalidate();
    }
    return report;
  }

  private async recordUsage(session: LibrarySession, outcome: { success: boolean; cancelled: boolean }): Promise<number> {
    const ids = [...session.usedItemIds];
    if (!ids.length) return 0;
    const succeeded = (id: string) => session.itemOutcomes.get(id) ?? outcome.success;
    await this.client.from('agent_library_usage').insert(ids.map(id => ({
      item_id: id,
      request_id: session.requestId,
      contributor: session.contributor,
      outcome: outcome.cancelled ? 'cancelled' : succeeded(id) ? 'success' : 'failure',
    })));
    if (outcome.cancelled) return 0;
    const items = await this.loadItems();
    let disabled = 0;
    for (const id of ids) {
      const item = items.find(row => row.id === id);
      if (!item) continue;
      const ok = succeeded(id);
      const next = { uses: item.uses + 1, successes: item.successes + (ok ? 1 : 0), failures: item.failures + (ok ? 0 : 1) };
      const off = shouldAutoDisable({ ...next, created_by: item.created_by });
      if (off) disabled += 1;
      await this.client.from('agent_library_items').update({
        ...next,
        last_used_at: nowIso(),
        updated_at: nowIso(),
        ...(off ? { status: 'disabled', disabled_reason: `Désactivé automatiquement : ${next.successes} réussite(s) sur ${next.uses} utilisations.` } : {}),
      }).eq('id', id);
    }
    return disabled;
  }

  private async promote(session: LibrarySession): Promise<{ created: number; versions: number; merged: number }> {
    const counts = { created: 0, versions: 0, merged: 0 };
    const eligible = session.candidates.filter(candidate => candidate.kind === 'skill' || candidate.succeeded !== false);
    if (!eligible.length) return counts;
    const items = await this.loadItems(true);
    const vectors = await this.embed(eligible.map(candidate => embeddingText(candidate)));
    for (const [index, candidate] of eligible.entries()) {
      if (libraryRejection(candidate.kind, candidate.name, candidate.definition)) continue;
      const slug = slugify(candidate.name);
      const embedding = vectors[index]?.length ? vectors[index] : null;
      const improves = candidate.improves ? items.find(item => item.id === candidate.improves && item.kind === candidate.kind) : null;
      const equivalent = improves || findEquivalent(items, { kind: candidate.kind, slug, embedding });
      const contributors = session.contributor ? [session.contributor] : [];
      if (equivalent && !improves && JSON.stringify(equivalent.definition).length >= JSON.stringify(candidate.definition).length) {
        // The same method already exists: it gains a contributor and a success, nothing is duplicated.
        await this.client.from('agent_library_items').update({
          contributors: [...new Set([...(equivalent.contributors || []), ...contributors])].slice(-200),
          uses: equivalent.uses + 1,
          successes: equivalent.successes + 1,
          updated_at: nowIso(),
        }).eq('id', equivalent.id);
        counts.merged += 1;
        continue;
      }
      if (equivalent) {
        // A better version: the old one is kept, archived, and the new one takes its place.
        const { error } = await this.client.from('agent_library_items').insert([{
          kind: candidate.kind,
          slug: equivalent.slug,
          name: candidate.name,
          description: candidate.description,
          version: equivalent.version + 1,
          status: equivalent.status === 'disabled' ? 'active' : equivalent.status,
          is_latest: true,
          parent_id: equivalent.id,
          definition: candidate.definition,
          tags: candidate.tags,
          embedding,
          contributors: [...new Set([...(equivalent.contributors || []), ...contributors])].slice(-200),
          created_by: 'agent',
        }]);
        if (!error) {
          await this.client.from('agent_library_items').update({ is_latest: false, status: 'archived', updated_at: nowIso() }).eq('id', equivalent.id);
          counts.versions += 1;
        }
        continue;
      }
      const { error } = await this.client.from('agent_library_items').insert([{
        kind: candidate.kind,
        slug,
        name: candidate.name,
        description: candidate.description,
        version: 1,
        status: 'active',
        is_latest: true,
        definition: candidate.definition,
        tags: candidate.tags,
        embedding,
        contributors,
        created_by: 'agent',
      }]);
      if (!error) counts.created += 1;
    }
    return counts;
  }

  private async recordErrors(session: LibrarySession, outcome: { success: boolean; cancelled: boolean }, summarize?: ErrorSummarizer): Promise<number> {
    // A user's correction is described in their words: only a generic restatement may be kept.
    const raw = session.errors.slice(0, 12);
    const missing = raw.filter(observation => !observation.rule || !observation.fix || observation.category === 'user_correction');
    if (missing.length && summarize) {
      const summaries = await summarize(missing).catch(() => [] as Array<Partial<ErrorObservation>>);
      missing.forEach((observation, index) => {
        const summary = summaries[index] || {};
        if (observation.category === 'user_correction') observation.message = summary.message || '';
        Object.assign(observation, { cause: summary.cause || observation.cause, fix: summary.fix || observation.fix, rule: summary.rule || observation.rule });
      });
    }
    const observations = raw
      .filter(observation => observation.category !== 'user_correction' || (observation.message && observation.rule))
      .map(sanitizeObservation);
    const memories = await this.loadMemories(true);
    const confirmed = outcome.success && !outcome.cancelled;
    let recorded = 0;
    const seen = new Set<string>();
    for (const observation of observations) {
      const signature = memorySignature(observation);
      if (seen.has(signature)) continue;
      seen.add(signature);
      const fallbackFix = fixCategory(observation.message, observation.library);
      const existing = memories.find(memory => memory.signature === signature);
      const now = nowIso();
      if (existing) {
        const patch = observe(existing, { confirmed, ruleWasGiven: session.injectedRuleIds.has(existing.id), libraries: session.projectLibraries, contributor: session.contributor, now });
        // A clearer rule from a confirmed fix improves one an admin has not written.
        const better = confirmed && !existing.edited_by_admin && observation.rule && observation.rule.length > existing.rule.length ? { rule: observation.rule, cause: observation.cause || existing.cause, fix: observation.fix || existing.fix } : {};
        await this.client.from('agent_error_memory').update({ ...patch, ...better, updated_at: now }).eq('id', existing.id);
        if (patch.permanent && !existing.permanent) await this.linkToSkill(existing.id, existing.context?.libraries || {});
      } else {
        await this.client.from('agent_error_memory').insert([{
          signature,
          category: observation.category,
          error_message: observation.message,
          context: { libraries: observation.libraries || {}, source: observation.source },
          cause: observation.cause || '',
          fix: observation.fix || fallbackFix,
          rule: observation.rule || `Éviter « ${observation.message.slice(0, 120)} » : ${observation.fix || fallbackFix}.`,
          status: confirmed ? 'active' : 'candidate',
          occurrences: 1,
          confirmations: confirmed ? 1 : 0,
          contributors: session.contributor ? [session.contributor] : [],
          last_seen_at: now,
        }]);
      }
      recorded += 1;
    }
    return recorded;
  }

  /** A permanent rule about a library joins the skill that uses it, as a known pitfall. */
  private async linkToSkill(memoryId: string, libraries: Record<string, number>) {
    const names = Object.keys(libraries);
    if (!names.length) return;
    const items = await this.loadItems();
    const skill = items.find(item => item.kind === 'skill' && item.status === 'active' && ((item.definition as SkillDefinition).dependencies || []).some(dependency => names.includes(dependency.replace(/@[^/]*$/, '').replace(/^(@[^/]+\/[^@]+)@.*$/, '$1'))));
    if (skill) await this.client.from('agent_error_memory').update({ skill_id: skill.id }).eq('id', memoryId);
  }

  /** Sharing turned off: this user's contributions leave the shared library. */
  async purgeContributor(contributor: string): Promise<number> {
    if (!this.client || !contributor) return 0;
    let removed = 0;
    for (const table of ['agent_library_items', 'agent_error_memory']) {
      const { data } = await this.client.from(table).select('id,contributors,created_by').contains('contributors', [contributor]).limit(2000);
      for (const row of data || []) {
        const rest = (row.contributors || []).filter((value: string) => value !== contributor);
        if (!rest.length && row.created_by !== 'admin' && row.created_by !== 'curated') {
          await this.client.from(table).delete().eq('id', row.id);
          removed += 1;
        } else {
          await this.client.from(table).update({ contributors: rest }).eq('id', row.id);
        }
      }
    }
    await this.client.from('agent_library_usage').update({ contributor: null }).eq('contributor', contributor);
    this.invalidate();
    return removed;
  }

  /* ---------------------------------------------------------------------- */
  /* Administration                                                          */
  /* ---------------------------------------------------------------------- */

  async adminListItems(filter: { kind?: string; status?: string; q?: string; versions?: boolean }) {
    let query = this.client.from('agent_library_items').select('id,kind,slug,name,description,version,status,is_latest,parent_id,definition,tags,uses,successes,failures,contributors,created_by,disabled_reason,last_used_at,created_at,updated_at').order('updated_at', { ascending: false }).limit(500);
    if (filter.kind === 'agent' || filter.kind === 'skill') query = query.eq('kind', filter.kind);
    if (filter.status) query = query.eq('status', filter.status);
    if (!filter.versions) query = query.eq('is_latest', true);
    if (filter.q) query = query.or(`name.ilike.%${filter.q.replace(/[%,()]/g, '')}%,description.ilike.%${filter.q.replace(/[%,()]/g, '')}%`);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((row: any) => ({ ...row, contributors: (row.contributors || []).length }));
  }

  async adminVersions(id: string) {
    const { data: item } = await this.client.from('agent_library_items').select('kind,slug').eq('id', id).maybeSingle();
    if (!item) return [];
    const { data } = await this.client.from('agent_library_items').select('id,version,status,is_latest,name,description,definition,uses,successes,failures,created_at').eq('kind', item.kind).eq('slug', item.slug).order('version', { ascending: false });
    return data || [];
  }

  async adminUpdateItem(id: string, patch: Record<string, unknown>) {
    const allowed: Record<string, unknown> = {};
    if (typeof patch.name === 'string') allowed.name = patch.name.slice(0, 80);
    if (typeof patch.description === 'string') allowed.description = patch.description.slice(0, 400);
    if (patch.definition && typeof patch.definition === 'object') allowed.definition = patch.definition;
    if (['active', 'disabled', 'candidate'].includes(String(patch.status))) {
      allowed.status = patch.status;
      allowed.disabled_reason = patch.status === 'disabled' ? String(patch.disabled_reason || 'Désactivé par un administrateur.') : null;
    }
    if (allowed.name || allowed.description || allowed.definition) allowed.embedding = null;
    allowed.updated_at = nowIso();
    const { error } = await this.client.from('agent_library_items').update(allowed).eq('id', id);
    if (error) throw error;
    this.invalidate();
  }

  async adminDeleteItem(id: string) {
    const { error } = await this.client.from('agent_library_items').delete().eq('id', id);
    if (error) throw error;
    this.invalidate();
  }

  async adminListMemories(filter: { status?: string; q?: string; sort?: string }) {
    let query = this.client.from('agent_error_memory').select('id,signature,category,error_message,context,cause,fix,rule,status,permanent,occurrences,confirmations,recurrences_after_rule,skill_id,contributors,edited_by_admin,last_seen_at,last_recurrence_at,created_at,updated_at').limit(500);
    if (filter.status) query = query.eq('status', filter.status);
    if (filter.q) query = query.or(`error_message.ilike.%${filter.q.replace(/[%,()]/g, '')}%,rule.ilike.%${filter.q.replace(/[%,()]/g, '')}%`);
    query = filter.sort === 'occurrences' ? query.order('occurrences', { ascending: false }) : query.order('recurrences_after_rule', { ascending: false }).order('last_seen_at', { ascending: false });
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((row: any) => ({ ...row, contributors: (row.contributors || []).length }));
  }

  async adminUpdateMemory(id: string, patch: Record<string, unknown>) {
    const allowed: Record<string, unknown> = { edited_by_admin: true, updated_at: nowIso(), embedding: null };
    for (const key of ['rule', 'cause', 'fix']) if (typeof patch[key] === 'string') allowed[key] = String(patch[key]).slice(0, 600);
    if (['active', 'disabled', 'needs_review', 'candidate'].includes(String(patch.status))) allowed.status = patch.status;
    if (typeof patch.permanent === 'boolean') allowed.permanent = patch.permanent;
    // Reviewed: the recurrence flag is acknowledged.
    if (patch.acknowledge === true) allowed.recurrences_after_rule = 0;
    const { error } = await this.client.from('agent_error_memory').update(allowed).eq('id', id);
    if (error) throw error;
    this.invalidate();
  }

  async adminDeleteMemory(id: string) {
    const { error } = await this.client.from('agent_error_memory').delete().eq('id', id);
    if (error) throw error;
    this.invalidate();
  }

  async adminOverview() {
    const [items, memories] = await Promise.all([
      this.client.from('agent_library_items').select('kind,status,is_latest,uses,successes').limit(5000),
      this.client.from('agent_error_memory').select('status,permanent,occurrences,recurrences_after_rule').limit(5000),
    ]);
    const rows = (items.data || []) as Array<{ kind: string; status: string; is_latest: boolean; uses: number; successes: number }>;
    const errorRows = (memories.data || []) as Array<{ status: string; permanent: boolean; occurrences: number; recurrences_after_rule: number }>;
    const latest = rows.filter(row => row.is_latest);
    return {
      agents: latest.filter(row => row.kind === 'agent' && row.status === 'active').length,
      skills: latest.filter(row => row.kind === 'skill' && row.status === 'active').length,
      disabled: latest.filter(row => row.status === 'disabled').length,
      versions: rows.length - latest.length,
      uses: rows.reduce((sum, row) => sum + (row.uses || 0), 0),
      successes: rows.reduce((sum, row) => sum + (row.successes || 0), 0),
      rules: errorRows.filter(row => row.status === 'active').length,
      permanentRules: errorRows.filter(row => row.permanent).length,
      needsReview: errorRows.filter(row => row.status === 'needs_review').length,
      recurring: errorRows.filter(row => row.recurrences_after_rule > 0).length,
      errorsSeen: errorRows.reduce((sum, row) => sum + (row.occurrences || 0), 0),
    };
  }
}
