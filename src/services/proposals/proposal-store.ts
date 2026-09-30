/**
 * Persistence for proposals (migration 20260930150000): a Supabase backend and
 * an in-memory one for tests and for a server without a database.
 * Every read and write is scoped to a project the caller has already been
 * checked against, and best-effort: a missing table means "no proposals",
 * never a failed run.
 */
import { randomUUID } from 'node:crypto';
import { isProposalLevel, type ProposalCategory, type ProposalDraft, type ProposalHistory, type ProposalLevel, type ProposalStatus } from './proposal-engine.ts';

export type StoredProposal = ProposalDraft & { id: string; projectId: string; userId: string; batchId: string; status: ProposalStatus; createdAt: string };
export type ProposalView = Pick<StoredProposal, 'id' | 'title' | 'why' | 'detail' | 'category' | 'status' | 'createdAt'>;

export interface ProposalBackend {
  insert(rows: Array<Omit<StoredProposal, 'id' | 'createdAt' | 'status'>>): Promise<StoredProposal[]>;
  list(projectId: string, statuses: ProposalStatus[]): Promise<StoredProposal[]>;
  get(projectId: string, id: string): Promise<StoredProposal | null>;
  setStatus(projectId: string, id: string, status: ProposalStatus): Promise<boolean>;
  allForProject(projectId: string): Promise<Array<Pick<StoredProposal, 'title' | 'status' | 'createdAt' | 'batchId'>>>;
  batchesSince(userId: string, sinceIso: string): Promise<number>;
  level(userId: string): Promise<ProposalLevel>;
  setLevel(userId: string, level: ProposalLevel): Promise<void>;
}

export const toView = (row: StoredProposal): ProposalView => ({ id: row.id, title: row.title, why: row.why, detail: row.detail, category: row.category, status: row.status, createdAt: row.createdAt });

const startOfDay = () => { const date = new Date(); date.setUTCHours(0, 0, 0, 0); return date.toISOString(); };

export class ProposalStore {
  constructor(private readonly backend: ProposalBackend) {}

  async level(userId: string): Promise<ProposalLevel> {
    return this.backend.level(userId).catch(() => 'normal' as ProposalLevel);
  }

  setLevel(userId: string, level: ProposalLevel) { return this.backend.setLevel(userId, level); }

  /** What the engine needs to decide whether and what to propose. `runsSince` is counted by the caller (versions saved). */
  async history(projectId: string, userId: string, runsSinceLastBatch: number): Promise<ProposalHistory> {
    const all = await this.backend.allForProject(projectId).catch(() => []);
    return {
      titles: all.map(row => row.title),
      dismissed: all.filter(row => row.status === 'dismissed').map(row => row.title),
      pending: all.filter(row => row.status === 'new').length,
      runsSinceLastBatch,
      batchesToday: await this.backend.batchesSince(userId, startOfDay()).catch(() => 0),
    };
  }

  async lastBatchAt(projectId: string): Promise<string | null> {
    const all = await this.backend.allForProject(projectId).catch(() => []);
    return all.map(row => row.createdAt).sort().pop() || null;
  }

  async add(projectId: string, userId: string, drafts: ProposalDraft[]): Promise<StoredProposal[]> {
    if (!drafts.length) return [];
    const batchId = randomUUID();
    return this.backend.insert(drafts.map(draft => ({ ...draft, projectId, userId, batchId })));
  }

  /** Waiting for an answer, plus the ones put off for later. */
  open(projectId: string) { return this.backend.list(projectId, ['new', 'later']); }
  get(projectId: string, id: string) { return this.backend.get(projectId, id); }
  answer(projectId: string, id: string, status: Exclude<ProposalStatus, 'new'>) { return this.backend.setStatus(projectId, id, status); }
}

export function memoryProposalBackend(): ProposalBackend & { rows: StoredProposal[] } {
  const rows: StoredProposal[] = [];
  const levels = new Map<string, ProposalLevel>();
  return {
    rows,
    async insert(items) {
      const made = items.map(item => ({ ...item, id: randomUUID(), createdAt: new Date().toISOString(), status: 'new' as ProposalStatus }));
      rows.push(...made);
      return made;
    },
    async list(projectId, statuses) { return rows.filter(row => row.projectId === projectId && statuses.includes(row.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    async get(projectId, id) { return rows.find(row => row.projectId === projectId && row.id === id) || null; },
    async setStatus(projectId, id, status) {
      const row = rows.find(item => item.projectId === projectId && item.id === id);
      if (!row) return false;
      row.status = status;
      return true;
    },
    async allForProject(projectId) { return rows.filter(row => row.projectId === projectId).map(({ title, status, createdAt, batchId }) => ({ title, status, createdAt, batchId })); },
    async batchesSince(userId, sinceIso) { return new Set(rows.filter(row => row.userId === userId && row.createdAt >= sinceIso).map(row => row.batchId)).size; },
    async level(userId) { return levels.get(userId) || 'normal'; },
    async setLevel(userId, level) { levels.set(userId, level); },
  };
}

const fromRow = (row: any): StoredProposal => ({
  id: row.id, projectId: row.project_id, userId: row.user_id, batchId: row.batch_id, title: row.title, why: row.why, detail: row.detail,
  prompt: row.prompt, category: row.category as ProposalCategory, status: row.status, createdAt: row.created_at,
});

export function supabaseProposalBackend(client: any): ProposalBackend {
  const fail = (error: any) => { if (error) throw error; };
  return {
    async insert(items) {
      const { data, error } = await client.from('agent_proposals').insert(items.map(item => ({
        project_id: item.projectId, user_id: item.userId, batch_id: item.batchId, title: item.title, why: item.why, detail: item.detail, prompt: item.prompt, category: item.category,
      }))).select('*');
      fail(error);
      return (data || []).map(fromRow);
    },
    async list(projectId, statuses) {
      const { data, error } = await client.from('agent_proposals').select('*').eq('project_id', projectId).in('status', statuses).order('created_at', { ascending: false }).limit(20);
      fail(error);
      return (data || []).map(fromRow);
    },
    async get(projectId, id) {
      const { data, error } = await client.from('agent_proposals').select('*').eq('project_id', projectId).eq('id', id).maybeSingle();
      fail(error);
      return data ? fromRow(data) : null;
    },
    async setStatus(projectId, id, status) {
      const { data, error } = await client.from('agent_proposals').update({ status, answered_at: new Date().toISOString() }).eq('project_id', projectId).eq('id', id).select('id');
      fail(error);
      return Boolean(data?.length);
    },
    async allForProject(projectId) {
      const { data, error } = await client.from('agent_proposals').select('title,status,created_at,batch_id').eq('project_id', projectId).order('created_at', { ascending: false }).limit(200);
      fail(error);
      return (data || []).map((row: any) => ({ title: row.title, status: row.status, createdAt: row.created_at, batchId: row.batch_id }));
    },
    async batchesSince(userId, sinceIso) {
      const { data, error } = await client.from('agent_proposals').select('batch_id').eq('user_id', userId).gte('created_at', sinceIso).limit(200);
      fail(error);
      return new Set((data || []).map((row: any) => row.batch_id)).size;
    },
    async level(userId) {
      const { data, error } = await client.from('user_agent_preferences').select('proposal_level').eq('user_id', userId).maybeSingle();
      fail(error);
      return isProposalLevel(data?.proposal_level) ? data.proposal_level : 'normal';
    },
    async setLevel(userId, level) {
      const { error } = await client.from('user_agent_preferences').upsert({ user_id: userId, proposal_level: level }, { onConflict: 'user_id' });
      fail(error);
    },
  };
}
