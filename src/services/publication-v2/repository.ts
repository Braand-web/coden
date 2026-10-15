import type { PublishSettings } from '../../shared/publish.ts';
import { requireDatabaseResult } from '../database-result.ts';
import { PublicationError, type PublicationSnapshot, type PublicationState } from './model.ts';

/** This adapter is server-only and requires the platform's service client. */
export class PublicationRepository {
  constructor(readonly client: any) {}
  async state(projectId: string): Promise<PublicationState | null> {
    return await requireDatabaseResult(this.client.from('project_publication_state').select('*').eq('project_id', projectId).maybeSingle(), 'read publication') as PublicationState || null;
  }
  async ensure(projectId: string, draft: PublishSettings): Promise<PublicationState> {
    await requireDatabaseResult(this.client.from('project_publication_state').upsert({ project_id: projectId, hosting_id: `coden-${projectId.replace(/-/g, '')}`, draft }, { onConflict: 'project_id', ignoreDuplicates: true }), 'initialize publication');
    const state = await this.state(projectId);
    if (!state) throw new PublicationError('PUBLICATION_UNAVAILABLE', 'État de publication indisponible.', 503);
    return state;
  }
  async saveDraft(projectId: string, settings: PublishSettings, host: string): Promise<void> {
    const result = await this.client.rpc('publication_reserve_address', { p_project: projectId, p_host: host });
    if (result.error?.message?.includes('PUBLICATION_ADDRESS_TAKEN')) throw new PublicationError('ADDRESS_TAKEN', 'Cette adresse est déjà réservée. Choisissez une autre adresse.');
    await requireDatabaseResult(Promise.resolve(result), 'reserve address');
    await requireDatabaseResult(this.client.from('project_publication_state').update({ draft: settings, updated_at: new Date().toISOString() }).eq('project_id', projectId), 'save publication draft');
  }
  async enqueue(snapshot: PublicationSnapshot, organizationId: string, key: string): Promise<string> {
    const result = await this.client.rpc('publication_enqueue', { p_id: snapshot.id, p_project: snapshot.project_id, p_actor: snapshot.actor_id, p_org: organizationId, p_key: key, p_job: `pub_${snapshot.id}`, p_snapshot: snapshot });
    if (result.error?.message?.includes('PUBLICATION_BUSY')) throw new PublicationError('PUBLICATION_BUSY', 'Une publication est déjà en cours. Son suivi reste disponible.');
    if (result.error?.message?.includes('PUBLICATION_REMOVAL_PENDING')) throw new PublicationError('UNPUBLISH_PENDING', 'Terminez le retrait de la publication avant de republier.');
    return await requireDatabaseResult(Promise.resolve(result), 'enqueue publication') as string;
  }
  async snapshot(id: string): Promise<PublicationSnapshot & { artifact?: any; candidate?: any; verified: boolean; activated: boolean }> {
    const row: any = await requireDatabaseResult(this.client.from('publication_snapshots').select('*').eq('id', id).single(), 'load publication snapshot');
    return { ...row.snapshot, artifact: row.artifact, candidate: row.candidate, verified: row.verified, activated: row.activated };
  }
  async checkpoint(id: string, update: { artifact?: any; candidate?: any; verified?: boolean }, lease: string): Promise<void> {
    await requireDatabaseResult(this.client.rpc('publication_checkpoint', { p_snapshot: id, p_lease: lease, p_patch: update }), 'checkpoint publication');
  }
  async activate(snapshotId: string, host: string, lease: string): Promise<void> {
    await requireDatabaseResult(this.client.rpc('publication_activate', { p_snapshot: snapshotId, p_host: host, p_lease: lease }), 'activate publication');
  }
  async activeJob(projectId: string): Promise<any | null> {
    const job: any = await requireDatabaseResult(this.client.from('agent_jobs').select('id,status,error,reconciliation_required,resume_count').eq('project_id', projectId).eq('type', 'publish').order('created_at', { ascending: false }).limit(1).maybeSingle(), 'read active publication');
    return job && !['completed', 'cancelled'].includes(job.status) ? job : null;
  }
  async lastEvent(jobId: string): Promise<any | null> {
    return await requireDatabaseResult(this.client.from('agent_job_events').select('sequence,step,message').eq('job_id', jobId).order('sequence', { ascending: false }).limit(1).maybeSingle(), 'read publication progress') || null;
  }
  async disable(projectId: string): Promise<number> {
    return await requireDatabaseResult(this.client.rpc('publication_disable', { p_project: projectId }), 'unpublish') as number;
  }
  async completeRemoval(projectId: string, generation: number): Promise<void> {
    const completed = await requireDatabaseResult(this.client.rpc('publication_complete_removal', { p_project: projectId, p_generation: generation }), 'complete publication removal');
    if (completed !== true) throw new PublicationError('UNPUBLISH_CHANGED', 'L’état du retrait a changé. Actualisez le panneau pour vérifier son résultat.');
  }
  async aliases(projectId: string): Promise<Array<{ host: string; active: boolean }>> {
    return await requireDatabaseResult(this.client.from('publication_aliases').select('host,active').eq('project_id', projectId), 'read publication aliases') as any[] || [];
  }
  async knownHost(projectId: string, host: string): Promise<boolean> {
    const row: any = await requireDatabaseResult(this.client.from('publication_aliases').select('project_id').eq('project_id', projectId).eq('host', host).eq('active', true).maybeSingle(), 'verify publication host');
    return !!row;
  }
}
