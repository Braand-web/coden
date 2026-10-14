import { describe, it, expect, vi } from 'vitest';
import { BuilderMediaService } from './service';
import type { MediaJob, MediaFile, MediaStore, MediaScope, MediaModel } from './contracts';
import { requestedMedia, readMediaCatalog, publicMediaJob } from './policy';
import { mediaStreamFilter, publicMediaText, registerPrivateMediaModels } from './public-filter';
const scope: MediaScope = { userId: 'u1', projectId: 'p1', accountId: 'a1', runId: 'r1', turnId: 't1', messageId: 'm1', requestText: 'Ajoute une illustration de montagne' };
const model: MediaModel = { key: 'balanced', provider: 'fal', model: 'fal-ai/test-image', kind: 'image', ratios: ['16:9'], credits: 3, costUsd: .1, quality: 'balanced', verifiedAt: new Date().toISOString() };
const args = { modelKey: model.key, prompt: 'Montagne minimaliste, bleu', purpose: 'Illustration du hero', ratio: '16:9', count: 1 };
class MemoryStore implements MediaStore {
  jobs = new Map<string, MediaJob>(); assets = new Map<string, MediaFile>();
  async create(job: MediaJob) { const old = [...this.jobs.values()].find(j => j.messageId === job.messageId && j.projectId === job.projectId && j.userId === job.userId); if (old) return structuredClone(old); this.jobs.set(job.id, structuredClone(job)); return structuredClone(job); }
  async get(id: string, s: Pick<MediaScope, 'projectId'|'userId'>) { const j = this.jobs.get(id); return j && j.userId === s.userId && j.projectId === s.projectId ? structuredClone(j) : null; }
  async save(job: MediaJob, revision: number) { if (this.jobs.get(job.id)?.revision !== revision) return null; const next = { ...structuredClone(job), revision: revision + 1 }; this.jobs.set(job.id, next); return structuredClone(next); }
  async active(n: number) { return [...this.jobs.values()].filter(j => !j.settled && j.authorization).slice(0,n).map(j => structuredClone(j)); }
  async list(s: Pick<MediaScope, 'projectId'|'userId'>) { return [...this.jobs.values()].filter(j => j.userId === s.userId && j.projectId === s.projectId); }
  async files(s: Pick<MediaScope, 'projectId'|'userId'>) { return [...this.assets.values()].filter(f => this.jobs.get(f.jobId)?.userId === s.userId && this.jobs.get(f.jobId)?.projectId === s.projectId); }
  async addFile(_s: MediaScope, f: MediaFile) { this.assets.set(f.id, f); }
}
function fixture() {
  const store = new MemoryStore();
  const submit = vi.fn(async () => ({ requestId: 'provider-request' }));
  const poll = vi.fn(async () => ({ status: 'completed' as const, bytes: new Uint8Array([1]), costUsd: .08 }));
  const reserve = vi.fn(async () => ({ id: 'reservation' })); const settle = vi.fn(async () => {}); const release = vi.fn(async () => {});
  const persist = vi.fn(async (j: MediaJob, index: number): Promise<MediaFile> => ({ id: j.id + index, jobId: j.id, path: 'public/assets/generated/123.webp', storagePath: j.userId + '/' + j.projectId + '/123.webp', bytes: 1, sha256: 'hash', kind: 'image', mime: 'image/webp' }));
  const materialize = vi.fn(async () => {});
  const deps = { enabled: () => true, models: () => [model], store, gateway: { submit, poll }, billing: { reserve, settle, release }, persist, materialize };
  return { deps, service: new BuilderMediaService(deps), store, submit, poll, reserve, settle, release, persist };
}
describe('main-brain media policy', () => {
  it.each(['Ajoute une image de montagne','Je veux une illustration pour le hero','Create a photo of a blue car'])('accepts explicit media intent: %s', text => expect(requestedMedia(text,'image')).toBe(true));
  it.each(['Améliore ce site', 'Utilise la photo jointe', 'Sans image', 'Ne génère pas de vidéo', 'Garde mes photos'])('does not invent consent: %s', text => expect(requestedMedia(text,'image') || requestedMedia(text,'video')).toBe(false));
  it('requires a current verified catalogue and finite known prices', () => {
    expect(readMediaCatalog(undefined)).toEqual([]);
    expect(readMediaCatalog(JSON.stringify([model]))).toEqual([model]);
    expect(readMediaCatalog(JSON.stringify([{ ...model, costUsd: null }, { ...model, verifiedAt: '2020-01-01' }]))).toEqual([]);
  });
  it('does not generate media simply because the tools exist', async () => { const f = fixture(); f.service.tools(scope); await f.service.tick(); expect(f.submit).not.toHaveBeenCalled(); });
  it('cannot approve a suggestion from model arguments', async () => {
    const f = fixture(); const j = await f.service.prepare({ ...scope, requestText: 'Améliore le site' }, { ...args, approved: true });
    expect(j.state).toBe('awaiting_approval'); await f.service.process(j.id, scope); expect(f.submit).not.toHaveBeenCalled();
  });
  it('declining a suggestion does not cancel independent development or spend', async () => {
    const f = fixture(); const j = await f.service.prepare({ ...scope, requestText: 'Améliore le site' }, args);
    await f.service.decide(j.id, scope, false); await f.service.process(j.id, scope);
    expect(f.submit).not.toHaveBeenCalled(); expect(f.reserve).not.toHaveBeenCalled(); expect((await f.service.get(j.id, scope))?.state).toBe('declined');
  });
  it('requires authenticated scope for confirmation', async () => {
    const f = fixture(); const j = await f.service.prepare({ ...scope, requestText: 'Améliore le site' }, args);
    await expect(f.service.decide(j.id, { ...scope, userId: 'u2' }, true)).rejects.toThrow('MEDIA_NOT_FOUND');
    await expect(f.service.decide(j.id, { ...scope, projectId: 'p2' }, true)).rejects.toThrow('MEDIA_NOT_FOUND');
    await f.service.decide(j.id, scope, true); await f.service.process(j.id, scope); expect(f.submit).toHaveBeenCalledOnce();
  });
  it('enforces count/duration and ignores AI-supplied approval', async () => {
    const f = fixture(); await expect(f.service.prepare(scope, { ...args, count: 5 })).rejects.toThrow('MEDIA_BATCH_LIMIT');
    await expect(f.service.prepare({ ...scope, requestText: 'Ajoute 1 image' }, { ...args, count: 2 })).rejects.toThrow('MEDIA_REQUEST_LIMIT');
  });
});
describe('durable billing and replay', () => {
  it('reserves before spend and charges exactly once after durable file delivery', async () => {
    const f = fixture(); const j = await f.service.prepare(scope, args);
    await f.service.process(j.id, scope); expect(f.settle).not.toHaveBeenCalled(); expect(f.submit).toHaveBeenCalledOnce();
    expect(f.reserve.mock.invocationCallOrder[0]).toBeLessThan(f.submit.mock.invocationCallOrder[0]);
    const done = await f.service.process(j.id, scope); expect(done.state).toBe('ready'); expect(done.creditsCharged).toBe(3);
    expect(f.persist.mock.invocationCallOrder[0]).toBeLessThan(f.settle.mock.invocationCallOrder[0]);
    await f.service.process(j.id, scope); expect(f.settle).toHaveBeenCalledOnce(); expect(f.submit).toHaveBeenCalledOnce();
  });
  it('one human message authorizes one bounded batch even with changed AI retry arguments', async () => {
    const f = fixture(); const first = await f.service.prepare(scope, args);
    const second = await f.service.prepare(scope, { ...args, prompt: 'Another prompt' }); expect(second.id).toBe(first.id);
    await Promise.all([f.service.process(first.id, scope), f.service.process(second.id, scope)]); expect(f.submit).toHaveBeenCalledOnce(); expect(f.reserve).toHaveBeenCalledOnce();
  });
  it('restarts polling the existing request, never another POST', async () => {
    const f = fixture(); const j = await f.service.prepare(scope, args); await f.service.process(j.id, scope);
    const resumed = new BuilderMediaService(f.deps); await resumed.tick();
    expect(f.submit).toHaveBeenCalledOnce(); expect(f.poll).toHaveBeenCalledOnce(); expect(f.settle).toHaveBeenCalledOnce();
  });
  it('ambiguous POST timeout is terminal without paid retry or debit', async () => {
    const f = fixture(); f.submit.mockRejectedValue(new Error('timeout')); const j = await f.service.prepare(scope, args);
    const done = await f.service.process(j.id, scope); await new BuilderMediaService(f.deps).tick();
    expect(done.state).toBe('unknown'); expect(done.creditsCharged).toBe(0); expect(f.submit).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce(); expect(f.settle).not.toHaveBeenCalled();
  });
  it('failed durable file delivery is not charged or regenerated', async () => {
    const f = fixture(); f.persist.mockRejectedValue(new Error('storage down')); const j = await f.service.prepare(scope, args);
    await f.service.process(j.id, scope); const done = await f.service.process(j.id, scope); await f.service.tick();
    expect(done.state).toBe('failed'); expect(done.creditsCharged).toBe(0); expect(f.release).toHaveBeenCalledOnce(); expect(f.submit).toHaveBeenCalledOnce();
  });
  it('credit refusal has zero supplier calls', async () => {
    const f = fixture(); f.reserve.mockRejectedValue(new Error('credit limit')); const j = await f.service.prepare(scope, args); await f.service.process(j.id,scope);
    expect(f.submit).not.toHaveBeenCalled(); expect(f.settle).not.toHaveBeenCalled();
  });
  it('only bills delivered assets in a partial batch', async () => {
    const f = fixture(); const j = await f.service.prepare({ ...scope, requestText: 'Ajoute 2 images' }, { ...args, count: 2 });
    f.submit.mockResolvedValueOnce({ requestId: 'one' }).mockRejectedValueOnce(new Error('timeout'));
    await f.service.process(j.id, scope); const done = await f.service.process(j.id,scope);
    expect(done.creditsMax).toBe(6); expect(done.creditsCharged).toBe(3); expect(f.settle).toHaveBeenCalledOnce();
  });
});
describe('supplier privacy', () => {
  it('only exposes the explicitly allowlisted job fields', async () => {
    const f = fixture(); const j = await f.service.prepare(scope,args); const text = JSON.stringify(publicMediaJob(j));
    expect(text).not.toMatch(/fal|provider|model|accountId|requestText|reservation|storagePath|costUsd/i);
  });
  it('masks complete public errors and registered technical IDs', () => {
    registerPrivateMediaModels([model.model]); expect(publicMediaText('OpenRouter fal.ai ' + model.model + ' https://fal.media/private.png')).not.toMatch(/OpenRouter|fal[.-]|private.png/);
    registerPrivateMediaModels([]);
  });
  it.each(['OpenRouter', '**fal.ai**', 'https://fal.media/path/asset.png', 'FAL_API_KEY'])('hides %s at every possible stream split', input => {
    for (let at=1; at<input.length; at++) {
      let text=''; const filter=mediaStreamFilter(s => { text += s; }); filter.push(input.slice(0,at)); filter.push(input.slice(at)); filter.end();
      expect(text).not.toMatch(/openrouter|fal(?:[._-]ai|[._-]api)|fal\.media/i);
    }
  });
});
