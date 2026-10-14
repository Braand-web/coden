import { randomUUID } from 'node:crypto';
import type { MediaBilling, MediaFile, MediaGateway, MediaJob, MediaModel, MediaScope, MediaStore, MediaTools } from './contracts.ts';
import { MEDIA_GUIDANCE, mediaFingerprint, publicMediaJob, requestedMedia, validateMediaInput } from './policy.ts';
import { MEDIA_TOOL_SCHEMAS } from './tool-schemas.ts';

export class BuilderMediaService {
  constructor(private deps: {
    enabled: () => boolean; models: () => MediaModel[]; store: MediaStore; gateway: MediaGateway; billing: MediaBilling;
    persist: (job: MediaJob, index: number, result: { bytes?: Uint8Array; url?: string }) => Promise<MediaFile>;
    materialize: (scope: Pick<MediaScope, 'projectId' | 'userId'>) => Promise<void>;
    announce?: (job: ReturnType<typeof publicMediaJob>) => void;
    now?: () => number;
  }) {}
  private now() { return this.deps.now?.() ?? Date.now(); }
  private available() { if (!this.deps.enabled()) throw new Error('MEDIA_DISABLED'); }
  async prepare(scope: MediaScope, args: Record<string, unknown>) {
    this.available();
    if (!scope.messageId || !scope.turnId || !scope.requestText) throw new Error('MEDIA_DURABLE_REQUEST_REQUIRED');
    const existing = await this.deps.store.list(scope);
    const same = existing.find(job => job.messageId === scope.messageId);
    if (same) return same;
    if (existing.filter(job => !job.settled && !['declined','awaiting_approval'].includes(job.state)).length >= 3
      || (await this.deps.store.files(scope)).length >= 80) throw new Error('MEDIA_PROJECT_LIMIT');
    const model = this.deps.models().find(m => m.key === args.modelKey);
    if (!model) throw new Error('MEDIA_MODEL_UNAVAILABLE');
    const input = validateMediaInput(args, model, scope.requestText);
    const explicit = requestedMedia(scope.requestText, model.kind);
    const createdAt = new Date(this.now()).toISOString();
    const job: MediaJob = { ...scope, id: randomUUID(), input, model, state: explicit ? 'approved' : 'awaiting_approval',
      createdAt, expiresAt: new Date(this.now() + 24 * 3600000).toISOString(), revision: 0,
      authorization: explicit ? 'request' : null, approvedAt: explicit ? createdAt : undefined,
      requests: Array.from({ length: input.count }, () => ({ state: 'pending' })),
      creditsMax: Math.ceil(model.credits * input.count * 100) / 100, creditsCharged: 0, settled: false };
    const saved = await this.deps.store.create(job, mediaFingerprint(scope, input));
    this.deps.announce?.(publicMediaJob(saved)); return saved;
  }
  async get(id: string, scope: Pick<MediaScope, 'projectId' | 'userId'>) { return this.deps.store.get(id, scope); }
  async decide(id: string, scope: Pick<MediaScope, 'projectId' | 'userId'>, accept: boolean) {
    this.available();
    const job = await this.get(id, scope); if (!job) throw new Error('MEDIA_NOT_FOUND');
    if (job.state !== 'awaiting_approval') return job;
    if (Date.parse(job.expiresAt) <= this.now()) throw new Error('MEDIA_QUOTE_EXPIRED');
    const changed = await this.deps.store.save({ ...job, state: accept ? 'approved' : 'declined', authorization: accept ? 'confirmation' : null,
      approvedAt: accept ? new Date(this.now()).toISOString() : undefined }, job.revision);
    const saved = changed || await this.get(id, scope); if (!saved) throw new Error('MEDIA_NOT_FOUND');
    this.deps.announce?.(publicMediaJob(saved)); return saved;
  }
  async process(id: string, scope: Pick<MediaScope, 'projectId' | 'userId'>) {
    this.available();
    let job = await this.get(id, scope); if (!job) throw new Error('MEDIA_NOT_FOUND');
    if (!job.authorization || ['awaiting_approval', 'declined'].includes(job.state) || job.settled) return job;
    if (Date.parse(job.leaseUntil || '') > this.now()) return job;
    const claimed = await this.deps.store.save({ ...job, leaseUntil: new Date(this.now() + 30 * 60000).toISOString() }, job.revision);
    if (!claimed) return (await this.get(id, scope))!;
    job = claimed;
    const save = async () => {
      const next = await this.deps.store.save(job!, job!.revision); if (!next) throw new Error('MEDIA_CONCURRENT_UPDATE');
      job = next;
    };
    try {
      if (job.state === 'approved') {
        if (Date.parse(job.expiresAt) <= this.now()) { job.state = 'failed'; await save(); }
        else {
          // Persist the boundary BEFORE reserving/spending. A lost acknowledgement is never retried blindly.
          job.state = 'submitting'; await save();
          try { job.reservation = await this.deps.billing.reserve(job); }
          catch { job.state = 'failed'; job.internalError = 'Reservation refused before supplier call'; await save(); }
          if (job.state !== 'failed') { await save(); job.state = 'queued'; await save(); }
        }
      } else if (job.state === 'submitting') {
        // Reservation replay is idempotent; no supplier POST can happen before queued.
        try { job.reservation = await this.deps.billing.reserve(job); job.state = 'queued'; }
        catch { job.state = 'failed'; }
        await save();
      }
      if (job.state === 'queued') {
        if (this.now() - Date.parse(job.approvedAt || job.createdAt) > 90 * 60000) {
          job.requests = job.requests.map(item => ['completed','failed','unknown'].includes(item.state) ? item : { ...item, state: 'unknown' });
          job.state = job.requests.some(item => item.file) ? 'ready' : 'unknown'; await save();
        }
      }
      if (job.state === 'queued') {
        for (let index = 0; index < job.requests.length; index++) {
          let item = job.requests[index];
          if (item.state === 'completed' || item.state === 'failed' || item.state === 'unknown') continue;
          if (item.state === 'submitting') { item.state = 'unknown'; await save(); continue; }
          let result: { requestId?: string; bytes?: Uint8Array; url?: string; costUsd?: number } | undefined;
          if (item.state === 'pending') {
            item.state = 'submitting'; await save();
            try { result = await this.deps.gateway.submit(job.model, { ...job.input, count: 1 }); }
            catch { job.requests[index].state = 'unknown'; job.internalError = 'Submission outcome unavailable'; await save(); continue; }
            item = job.requests[index];
            item.requestId = result.requestId;
            item.state = result.bytes || result.url ? 'queued' : result.requestId ? 'queued' : 'unknown';
            await save();
          } else if (item.requestId) {
            const polled = await this.deps.gateway.poll(job.model, item.requestId);
            if (polled.status === 'failed') { job.requests[index].state = 'failed'; await save(); continue; }
            if (polled.status === 'pending') continue;
            result = polled;
          }
          if (result?.bytes || result?.url) {
            let file: MediaFile;
            try { file = await this.deps.persist(job, index, result); await this.deps.store.addFile(job, file); }
            catch {
              // Known unusable responses are absorbed by Coden, never resubmitted.
              job.requests[index].state = 'failed'; job.internalError = 'Durable media delivery failed'; await save(); continue;
            }
            job.requests[index] = { ...job.requests[index], state: 'completed', file,
              costUsd: Number.isFinite(result.costUsd) ? Number(result.costUsd) : job.model.costUsd };
            await save();
          }
        }
        if (job.requests.every(r => ['completed', 'failed', 'unknown'].includes(r.state))) {
          job.state = job.requests.some(r => r.file) ? 'ready' : job.requests.some(r => r.state === 'unknown') ? 'unknown' : 'failed';
          await save();
        }
      }
      if (['ready', 'failed', 'unknown'].includes(job.state) && !job.settled) {
        const files = job.requests.filter(r => r.file);
        const credits = Math.min(job.creditsMax, Math.ceil(files.length * job.model.credits * 100) / 100);
        if (files.length) await this.deps.billing.settle(job, credits, files.reduce((sum, r) => sum + (r.costUsd || 0), 0));
        else if (job.reservation) await this.deps.billing.release(job);
        job.creditsCharged = credits; job.settled = true; await save();
      }
      if (job.requests.some(r => r.file)) await this.deps.materialize(scope);
      return job;
    } finally {
      // Short polling leases, not ownership of a browser connection.
      job.leaseUntil = new Date(this.now()).toISOString();
      const next = await this.deps.store.save(job, job.revision);
      if (next) { job = next; this.deps.announce?.(publicMediaJob(job)); }
    }
  }
  async tick() {
    if (!this.deps.enabled()) return;
    for (const job of await this.deps.store.active(20)) {
      try { await this.process(job.id, job); } catch { /* Keep durable state; never retry a submission. */ }
    }
  }
  tools(scope: MediaScope, announce?: (job: ReturnType<typeof publicMediaJob>) => void): MediaTools {
    return { schemas: MEDIA_TOOL_SCHEMAS.map(s => ({ ...s })), guidance: MEDIA_GUIDANCE, restore: () => this.deps.materialize(scope), call: async (name, args) => {
      this.available();
      if (name === 'list_media_models') return { ok: true, models: this.deps.models().map(m => ({ key: m.key, provider: m.provider, model: m.model, kind: m.kind, ratios: m.ratios, durations: m.durations, quality: m.quality, creditsMaximumPerAsset: m.credits })) };
      if (name === 'list_project_media') { await this.deps.materialize(scope); return { ok: true, assets: (await this.deps.store.files(scope)).map(f => ({ id: f.id, path: f.path, kind: f.kind, poster: f.poster?.path })) }; }
      let job: MediaJob | null;
      if (name === 'prepare_media_batch') job = await this.prepare(scope, args);
      else if (name === 'generate_media_batch') job = await this.process(String(args.jobId || ''), scope);
      else if (name === 'get_media_job') job = await this.get(String(args.jobId || ''), scope);
      else return { ok: false, error: 'MEDIA_TOOL_UNAVAILABLE' };
      if (!job) return { ok: false, error: 'MEDIA_NOT_FOUND' };
      const view = publicMediaJob(job); announce?.(view); return { ok: true, job: view };
    } };
  }
}
