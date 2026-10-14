import type { MediaFile, MediaJob, MediaScope, MediaStore } from './contracts.ts';

/** No browser client is ever allowed to query this store. */
export class SupabaseMediaStore implements MediaStore {
  constructor(private client: () => any) {}
  private db() { const db = this.client(); if (!db) throw new Error('MEDIA_STORE_UNAVAILABLE'); return db; }
  async create(job: MediaJob, fingerprint: string) {
    const row = { id: job.id, project_id: job.projectId, user_id: job.userId, message_id: job.messageId, fingerprint, revision: 0, state: job.state, settled: false, payload: job };
    const result = await this.db().from('coden_media_jobs').insert(row).select('payload').single();
    if (!result.error) return result.data.payload as MediaJob;
    if (result.error.code !== '23505') throw new Error('MEDIA_STORE_UNAVAILABLE');
    // One bounded batch per durable user message, not one per model-generated retry key.
    const existing = await this.db().from('coden_media_jobs').select('payload').eq('project_id', job.projectId).eq('user_id', job.userId).eq('message_id', job.messageId).single();
    if (existing.error) throw new Error('MEDIA_STORE_UNAVAILABLE'); return existing.data.payload as MediaJob;
  }
  async get(id: string, scope: Pick<MediaScope, 'projectId' | 'userId'>) {
    const r = await this.db().from('coden_media_jobs').select('payload').eq('id', id).eq('project_id', scope.projectId).eq('user_id', scope.userId).maybeSingle();
    if (r.error) throw new Error('MEDIA_STORE_UNAVAILABLE'); return (r.data?.payload || null) as MediaJob | null;
  }
  async save(job: MediaJob, expectedRevision: number) {
    const next = { ...job, revision: expectedRevision + 1 };
    const r = await this.db().from('coden_media_jobs').update({ state: next.state, settled: next.settled, revision: next.revision, payload: next, updated_at: new Date().toISOString() })
      .eq('id', job.id).eq('project_id', job.projectId).eq('user_id', job.userId).eq('revision', expectedRevision).select('payload');
    if (r.error) throw new Error('MEDIA_STORE_UNAVAILABLE'); return (r.data?.[0]?.payload || null) as MediaJob | null;
  }
  async active(limit: number) {
    const r = await this.db().from('coden_media_jobs').select('payload').eq('settled', false).in('state', ['approved', 'submitting', 'queued', 'ready', 'failed', 'unknown']).order('updated_at').limit(limit);
    if (r.error) throw new Error('MEDIA_STORE_UNAVAILABLE'); return (r.data || []).map((row: any) => row.payload as MediaJob).filter((job: MediaJob) => !job.settled);
  }
  async files(scope: Pick<MediaScope, 'projectId' | 'userId'>) {
    const r = await this.db().from('coden_media_files').select('payload').eq('project_id', scope.projectId).eq('user_id', scope.userId).order('created_at');
    if (r.error) throw new Error('MEDIA_STORE_UNAVAILABLE'); return (r.data || []).map((row: any) => row.payload as MediaFile);
  }
  async list(scope: Pick<MediaScope, 'projectId' | 'userId'>) {
    const r = await this.db().from('coden_media_jobs').select('payload').eq('project_id', scope.projectId).eq('user_id', scope.userId).order('created_at', { ascending: false }).limit(100);
    if (r.error) throw new Error('MEDIA_STORE_UNAVAILABLE'); return (r.data || []).map((row: any) => row.payload as MediaJob);
  }
  async addFile(scope: MediaScope, file: MediaFile) {
    const r = await this.db().from('coden_media_files').upsert({ id: file.id, project_id: scope.projectId, user_id: scope.userId, job_id: file.jobId, payload: file }, { onConflict: 'id' });
    if (r.error) throw new Error('MEDIA_STORE_UNAVAILABLE');
  }
}
