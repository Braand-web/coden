import type { Express } from 'express';
import type { PublicationAccessService } from './access.ts';
import { verifyPlatformSecret } from './access.ts';
import { PublicationError } from './model.ts';
import type { PublicationProject, PublicationService } from './service.ts';
import type { CodenJob } from '../async-job-queue.ts';
import { resumePublishJob } from '../async-job-queue.ts';

export interface PublicationRoutesDependencies {
  app: Express;
  enabled(): boolean;
  requireAuth: any;
  project(req: any): Promise<PublicationProject>;
  actorId(req: any): string;
  service(): PublicationService;
  access(): PublicationAccessService;
  getJob(id: string): Promise<CodenJob | null>;
  platformSecret(): string;
  rateLimit(key: string): boolean;
}
export function publicationApiError(res: any, error: unknown) {
  const known = error instanceof PublicationError;
  return res.status(known ? error.status : 503).json({ success: false, diagnostic_code: known ? error.code : 'PUBLICATION_UNAVAILABLE', error: known ? error.message : 'La publication est indisponible. Votre projet est conservé, réessayez dans un instant.' });
}
export async function publicationV2Publish(req: any, res: any, deps: PublicationRoutesDependencies) {
  try {
    const actor = deps.actorId(req);
    if (!deps.rateLimit(`publish-v2:${actor}`)) throw new PublicationError('RATE_LIMITED', 'Patientez avant une nouvelle publication.', 429);
    const project = await deps.project(req);
    const service = deps.service();
    let jobId: string;
    if (req.body?.resume_job_id) {
      if (req.body?.confirmed !== true) throw new PublicationError('CONFIRMATION_REQUIRED', 'Confirmez la reprise de cette version.');
      const job = await deps.getJob(String(req.body.resume_job_id));
      if (!job || job.project_id !== project.id || job.type !== 'publish') throw new PublicationError('JOB_NOT_FOUND', 'Publication introuvable.', 404);
      await deps.service().deps.assertCanPublish(project.id, actor);
      const snapshot = await service.deps.repository.snapshot(String(job.payload.publication_snapshot_id));
      const state = await service.state(project);
      if ((snapshot.publication_generation || 0) !== (state.generation || 0)) throw new PublicationError('PUBLICATION_INVALIDATED', 'Cette publication a été retirée. Lancez une nouvelle publication.');
      if (!await resumePublishJob(job.id, job.user_id)) throw new PublicationError('RESUME_UNAVAILABLE', 'Cette publication ne peut pas être reprise. Son état doit être vérifié.');
      jobId = job.id;
    } else jobId = await service.enqueue(project, actor, String(req.body?.idempotency_key || req.get('idempotency-key') || ''), req.body?.confirmed === true || req.body?.approvalGranted === true);
    if (req.body?.async === true) return res.status(202).json({ success: true, job_id: jobId, publish: await service.status(project, actor) });
    // Compatibility for the existing synchronous client. HTTP disconnect never
    // cancels the already durable operation. New clients use 202 and status/SSE.
    for (let attempt = 0; attempt < 900; attempt++) {
      const job = await deps.getJob(jobId);
      if (!job) throw new PublicationError('JOB_UNAVAILABLE', 'Suivi indisponible. Actualisez le panneau.', 503);
      if (job.status === 'completed') {
        const status = await service.status(project, actor);
        return res.json({ success: true, job_id: jobId, deployment: { id: job.result?.release_id, provider: 'cloudflare-workers', status: 'ready', public_url: status.public_url }, publish: { ...status, state: status.has_unpublished_changes ? 'changes_unpublished' : 'published', badge_required: false, custom_domain: null } });
      }
      if (job.status === 'failed' || job.status === 'cancelled') throw new PublicationError('PUBLICATION_FAILED', 'La publication n’a pas abouti. Ouvrez le suivi pour réessayer.', 502);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return res.status(202).json({ success: true, job_id: jobId, publish: await service.status(project, actor) });
  } catch (error) { return publicationApiError(res, error); }
}
export function registerPublicationV2Routes(deps: PublicationRoutesDependencies) {
  const { app } = deps;
  app.put('/api/projects/:id/publish/settings', deps.requireAuth, async (req: any, res: any, next: any) => {
    if (!deps.enabled()) return next();
    try {
      const project = await deps.project(req);
      await deps.service().settings(project, deps.actorId(req), req.body);
      return res.json({ success: true, publish: await deps.service().status(project, deps.actorId(req)) });
    } catch (error) { return publicationApiError(res, error); }
  });
  app.delete('/api/projects/:id/publish', deps.requireAuth, async (req: any, res: any, next: any) => {
    if (!deps.enabled()) return next();
    try {
      const project = await deps.project(req);
      await deps.service().unpublish(project, deps.actorId(req));
      return res.json({ success: true, publish: await deps.service().status(project, deps.actorId(req)) });
    } catch (error) { return publicationApiError(res, error); }
  });
  app.post('/api/publication-access/handoff', deps.requireAuth, async (req: any, res: any) => {
    if (!deps.enabled()) return res.status(404).end();
    try {
      if (!deps.rateLimit(`publication-login:${deps.actorId(req)}`)) return res.status(429).end();
      const url = await deps.access().handoff(String(req.body?.project_id || ''), deps.actorId(req), String(req.body?.host || ''), req.body?.return_path);
      return res.set('Cache-Control', 'no-store').json({ success: true, url });
    } catch { return res.status(403).json({ success: false, error: 'Ce site n’est pas accessible avec ce compte.' }); }
  });
  for (const operation of ['authorize', 'exchange'] as const) app.post(`/api/publication-access/${operation}`, async (req: any, res: any) => {
    res.set('Cache-Control', 'no-store');
    if (!deps.enabled() || !verifyPlatformSecret(req.get('authorization'), deps.platformSecret())) return res.status(403).json({ allowed: false });
    try {
      const project = String(req.body?.project_id || '');
      const host = String(req.body?.host || '');
      const result = operation === 'authorize'
        ? await deps.access().authorize(project, host, req.body?.session)
        : await deps.access().exchange(project, host, String(req.body?.code || ''));
      return res.json(result);
    } catch { return res.status(503).json({ allowed: false }); }
  });
}
