import { randomUUID } from 'node:crypto';
import type { PublicationStatusV2, PublishPhase, PublishSettings } from '../../shared/publish.ts';
import { PublicationError, normalizePublishSettings, publicationFingerprint, suggestedSettings, type PublicationSnapshot, type PublicationState } from './model.ts';
import type { PublicationRepository } from './repository.ts';

export type PublicationProject = { id: string; name: string; slug?: string; owner_id: string; organization_id: string };
export interface PublicationProvider {
  build(snapshot: PublicationSnapshot): Promise<unknown>;
  stage(snapshot: PublicationSnapshot, artifact: any, hostingId: string): Promise<unknown>;
  verify(snapshot: PublicationSnapshot, candidate: any, live: boolean): Promise<void>;
  activate(snapshot: PublicationSnapshot, candidate: any, state: PublicationState, hosts: string[]): Promise<void>;
  remove(state: PublicationState, hosts: string[]): Promise<void>;
}
export interface PublicationDependencies {
  repository: PublicationRepository;
  rootDomain: string;
  provider: PublicationProvider;
  assertCanPublish(projectId: string, actorId: string): Promise<void>;
  workspaceAllowed(project: PublicationProject): Promise<boolean>;
  defaults?(project: PublicationProject): Promise<PublishSettings>;
  capture(project: PublicationProject, actorId: string, settings: PublishSettings): Promise<Omit<PublicationSnapshot, 'id' | 'fingerprint'>>;
  checks(project: PublicationProject): Promise<PublicationStatusV2['checks']>;
  retireLegacyOrigins?(projectId: string, actorId: string): Promise<void>;
  assertSnapshotSafe?(snapshot: PublicationSnapshot): Promise<void>;
  onActivated?(snapshot: PublicationSnapshot): Promise<void>;
  onUnpublished?(projectId: string): Promise<void>;
}

export class PublicationService {
  constructor(readonly deps: PublicationDependencies) {}
  host(settings: PublishSettings): string { return `${settings.subdomain}.${this.deps.rootDomain}`; }
  async state(project: PublicationProject) {
    return await this.deps.repository.state(project.id) || this.deps.repository.ensure(project.id, this.deps.defaults ? await this.deps.defaults(project) : suggestedSettings(project));
  }
  async settings(project: PublicationProject, actorId: string, value: unknown): Promise<void> {
    await this.deps.assertCanPublish(project.id, actorId);
    const draft = normalizePublishSettings(value, await this.deps.workspaceAllowed(project));
    await this.state(project);
    await this.deps.repository.saveDraft(project.id, draft, this.host(draft));
  }
  async status(project: PublicationProject, actorId: string): Promise<PublicationStatusV2> {
    const state = await this.state(project);
    const [checks, allowed, job] = await Promise.all([this.deps.checks(project), this.deps.workspaceAllowed(project), this.deps.repository.activeJob(project.id)]);
    let canPublish = true;
    try { await this.deps.assertCanPublish(project.id, actorId); } catch { canPublish = false; }
    let captured: Awaited<ReturnType<PublicationDependencies['capture']>> | null = null;
    try { captured = await this.deps.capture(project, actorId, state.draft); }
    catch (error) {
      if (!(error instanceof PublicationError)) throw error;
      checks.push({ id: 'draft', label: 'Brouillon à corriger', status: 'fail', detail: error.message });
    }
    const event = job ? await this.deps.repository.lastEvent(job.id) : null;
    if (state.removal_pending) checks.push({ id: 'removal_pending', label: 'Retrait à terminer', status: 'fail', detail: 'Les accès Coden sont bloqués. Terminez le nettoyage des accès fournisseur avant de republier.' });
    const phase: PublishPhase = job?.status === 'failed' ? 'failed' : ['validating', 'building', 'uploading', 'verifying', 'activating', 'completed'].includes(event?.step) ? event.step : 'queued';
    return {
      version: 2, draft: state.draft, effective: state.enabled ? state.effective : null,
      proposed_url: `https://${this.host(state.draft)}`,
      public_url: state.enabled && state.effective ? `https://${this.host(state.effective)}` : null,
      has_unpublished_changes: !state.enabled || !captured || state.fingerprint !== publicationFingerprint(captured),
      can_publish: canPublish && !state.removal_pending && !job?.reconciliation_required && !checks.some(c => c.status === 'fail'), can_use_workspace: allowed, removal_pending: !!state.removal_pending, checks,
      active_job: job ? { id: job.id, status: job.status, phase, message: event?.step === 'resume_requested' ? 'Reprise de la version capturée demandée.' : event?.message || 'Publication en attente.', sequence: Number(event?.sequence || 0), reconciliation_required: !!job.reconciliation_required, recoverable: !!job.reconciliation_required && Number(job.resume_count || 0) < 3, ...(job.error ? { error: 'La publication a été interrompue. Le projet et sa version capturée sont conservés.' } : {}) } : null,
    };
  }
  async enqueue(project: PublicationProject, actorId: string, key: string, confirmed: boolean): Promise<string> {
    await this.deps.assertCanPublish(project.id, actorId);
    if (!confirmed) throw new PublicationError('CONFIRMATION_REQUIRED', 'Confirmez la publication avant de continuer.');
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) throw new PublicationError('IDEMPOTENCY_REQUIRED', 'Clé de publication invalide.', 400);
    const state = await this.state(project);
    if (state.removal_pending) throw new PublicationError('UNPUBLISH_PENDING', 'Terminez le retrait de la publication avant de republier.');
    const settings = normalizePublishSettings(state.draft, await this.deps.workspaceAllowed(project));
    const checks = await this.deps.checks(project);
    const blocker = checks.find(check => check.status === 'fail');
    if (blocker) throw new PublicationError('PUBLICATION_BLOCKED', blocker.detail || blocker.label);
    const captured = await this.deps.capture(project, actorId, settings);
    const aliases = (await this.deps.repository.aliases(project.id)).filter(alias => alias.active).map(alias => alias.host);
    const snapshot: PublicationSnapshot = { ...captured, id: randomUUID(), hosts: [...new Set([...(captured.hosts || []), ...aliases, this.host(settings)])], publication_generation: state.generation || 0, fingerprint: publicationFingerprint(captured) };
    await this.deps.repository.saveDraft(project.id, settings, this.host(settings));
    return this.deps.repository.enqueue(snapshot, project.organization_id, key);
  }
  async rollback(project: PublicationProject, actorId: string, releaseId: string, key: string): Promise<string> {
    await this.deps.assertCanPublish(project.id, actorId);
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) throw new PublicationError('IDEMPOTENCY_REQUIRED', 'Clé de publication invalide.', 400);
    const state = await this.state(project);
    if (!state.enabled || !state.effective) throw new PublicationError('NOT_PUBLISHED', 'Publiez le projet avant de restaurer une version.');
    const old = await this.deps.repository.snapshot(releaseId);
    if (old.project_id !== project.id || !old.activated || !old.artifact) throw new PublicationError('RELEASE_NOT_FOUND', 'Version de publication introuvable.', 404);
    const snapshot: PublicationSnapshot = { ...old, actor_id: actorId, id: randomUUID(),
      settings: state.effective, restored_from: old.id, publication_generation: state.generation || 0, fingerprint: '' };
    delete (snapshot as any).artifact; delete (snapshot as any).candidate; delete (snapshot as any).verified; delete (snapshot as any).activated;
    snapshot.hosts = (await this.deps.repository.aliases(project.id)).filter(alias => alias.active).map(alias => alias.host);
    await this.deps.assertSnapshotSafe?.(snapshot);
    snapshot.fingerprint = publicationFingerprint(snapshot);
    return this.deps.repository.enqueue(snapshot, project.organization_id, key);
  }
  async run(snapshotId: string, progress: (step: string, message: string) => void | Promise<void>, context: { lease: string; signal?: AbortSignal; renewLease?: () => Promise<void> }): Promise<Record<string, unknown>> {
    const fence = async () => { context.signal?.throwIfAborted(); await context.renewLease?.(); context.signal?.throwIfAborted(); };
    await fence();
    const snapshot = await this.deps.repository.snapshot(snapshotId);
    if (snapshot.activated) return { release_id: snapshot.id, public_url: `https://${this.host(snapshot.settings)}` };
    await progress('validating', 'Vérification des droits et de la version capturée.');
    await this.deps.assertCanPublish(snapshot.project_id, snapshot.actor_id);
    await this.deps.assertSnapshotSafe?.(snapshot);
    const state = await this.deps.repository.state(snapshot.project_id);
    if (!state) throw new PublicationError('PUBLICATION_UNAVAILABLE', 'État de publication introuvable.', 503);
    if ((snapshot.publication_generation || 0) !== (state.generation || 0)) throw new PublicationError('PUBLICATION_INVALIDATED', 'Cette publication a été annulée par une dépublication. Lancez une nouvelle publication.');
    let artifact = snapshot.artifact;
    if (!artifact) {
      await progress('building', 'Construction de la version à publier.');
      await fence();
      artifact = await this.deps.provider.build(snapshot);
      await this.deps.repository.checkpoint(snapshot.id, { artifact }, context.lease);
    }
    let candidate = snapshot.candidate;
    if (!candidate) {
      await progress('uploading', 'Envoi de la version candidate protégée.');
      await fence();
      candidate = await this.deps.provider.stage(snapshot, artifact, state.hosting_id);
      await this.deps.repository.checkpoint(snapshot.id, { candidate }, context.lease);
    }
    await progress('verifying', 'Contrôle du contenu de la version candidate.');
    await fence();
    await this.deps.provider.verify(snapshot, candidate, false);
    // Recheck after potentially long build/provider calls; editor/viewer never
    // acquires publication rights merely because a job has been enqueued.
    await this.deps.assertCanPublish(snapshot.project_id, snapshot.actor_id);
    await progress('activating', 'Activation et vérification de l’adresse publique.');
    await fence();
    await this.deps.retireLegacyOrigins?.(snapshot.project_id, snapshot.actor_id);
    const hosts = (await this.deps.repository.aliases(snapshot.project_id)).filter(alias => alias.active).map(alias => alias.host);
    await fence();
    await this.deps.provider.activate(snapshot, candidate, state, [...new Set([...hosts, ...(snapshot.hosts || []), this.host(snapshot.settings)])]);
    await this.deps.provider.verify(snapshot, candidate, true);
    await this.deps.assertCanPublish(snapshot.project_id, snapshot.actor_id);
    await fence();
    await this.deps.repository.checkpoint(snapshot.id, { verified: true }, context.lease);
    await this.deps.repository.activate(snapshot.id, this.host(snapshot.settings), context.lease);
    // Notification failure is recorded by the outbox and never reverses a
    // publication which has already been successfully activated.
    try { await this.deps.onActivated?.(snapshot); } catch { /* durable outbox remains pending */ }
    await progress('completed', 'La version publiée a été vérifiée.');
    return { release_id: snapshot.id, public_url: `https://${this.host(snapshot.settings)}` };
  }
  async unpublish(project: PublicationProject, actorId: string): Promise<void> {
    await this.deps.assertCanPublish(project.id, actorId);
    const state = await this.state(project);
    // Fail closed immediately at the gateway, even if provider removal fails.
    const removalGeneration = await this.deps.repository.disable(project.id);
    await this.deps.retireLegacyOrigins?.(project.id, actorId);
    const hosts = (await this.deps.repository.aliases(project.id)).map(alias => alias.host);
    await this.deps.provider.remove(state, hosts);
    await this.deps.repository.completeRemoval(project.id, removalGeneration);
    await this.deps.onUnpublished?.(project.id);
  }
}
