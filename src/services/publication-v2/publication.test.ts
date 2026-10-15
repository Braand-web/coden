import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPublicationTestDatabase } from './test-database.ts';
import { PublicationRepository } from './repository.ts';
import { PublicationService, type PublicationProvider } from './service.ts';
import { PublicationAccessService } from './access.ts';
import { applyPublicationMetadata, normalizePublishSettings, publicationFingerprint, safeReturnPath, sourcePublicationMetadata, tokenDigest, PublicationError, type PublicationSnapshot } from './model.ts';
import { deliverPublicationInvitations } from './invitations.ts';

const project = { id: '10000000-0000-4000-8000-000000000001', owner_id: '20000000-0000-4000-8000-000000000001', organization_id: '30000000-0000-4000-8000-000000000001', name: 'Chez Marcel', slug: 'chez-marcel' };
const guest = '20000000-0000-4000-8000-000000000002';
const other = '20000000-0000-4000-8000-000000000003';
describe('Publication V2 with local PostgreSQL', () => {
  let fixture: Awaited<ReturnType<typeof createPublicationTestDatabase>>;
  let repository: PublicationRepository;
  let service: PublicationService;
  let access: PublicationAccessService;
  let content = '<head><title>Restaurant</title></head><body>Carte du jour</body>';
  let brokenDraft = false;
  const provider: PublicationProvider = { build: vi.fn(async () => ({ index: content })), stage: vi.fn(async snapshot => ({ release: snapshot.id })), verify: vi.fn(async () => {}), activate: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
  beforeAll(async () => {
    fixture = await createPublicationTestDatabase();
    await fixture.db.query('insert into projects values($1,$2,$3)', [project.id, project.owner_id, project.organization_id]);
    repository = new PublicationRepository(fixture.client);
    service = new PublicationService({ repository, rootDomain: 'coden.test', provider,
      assertCanPublish: async (_id, actor) => { if (actor !== project.owner_id) throw new Error('Denied'); }, workspaceAllowed: async () => true,
      capture: async (project, actor, settings) => { if (brokenDraft) throw new PublicationError('INVALID_RUNTIME_CONTRACT', 'Brouillon invalide.'); return { project_id: project.id, actor_id: actor, settings, files: [{ path: 'index.html', content }], manifest: { runtime: 'static-assets' }, public_env: {} }; },
      checks: async () => [{ id: 'security', label: 'Analyse statique', status: 'pass' }], onActivated: async () => { throw new Error('email failure'); },
    });
    access = new PublicationAccessService({ repository, rootDomain: 'coden.test', codenOrigin: 'https://coden.test', getIdentity: async id => ({ id, email: id === guest ? 'invite@example.test' : 'other@example.test', emailVerified: true }), isOwnerOrAdmin: async (_p, id) => id === project.owner_id, isWorkspaceMember: async () => false, workspaceStillAllowed: async () => true });
  }, 30000);
  afterAll(async () => { await fixture?.db.close(); });
  async function complete(jobId: string) {
    const claims = await fixture.db.query<any>("select * from claim_agent_jobs('local-test',3,60,array['publish'])");
    const claim = claims.rows.find(row => row.id === jobId);
    expect(claim).toBeTruthy();
    const { rows } = await fixture.db.query<any>('select payload from agent_jobs where id=$1', [jobId]);
    const result = await service.run(rows[0].payload.publication_snapshot_id, async (step, message) => { await fixture.db.query('insert into agent_job_events(job_id,step,message) values($1,$2,$3)', [jobId, step, message]); }, { lease: claim.lease_token });
    await fixture.db.query("update agent_jobs set status='completed',result=$2,lease_token=null,lease_owner=null,lease_expires_at=null where id=$1", [jobId, JSON.stringify(result)]);
  }
  it('keeps proposed address non-live; freezes source and settings at confirmation', async () => {
    const initial = await service.status(project, project.owner_id);
    expect(initial.public_url).toBeNull(); expect(initial.effective).toBeNull();
    const key = 'first-publication';
    const jobId = await service.enqueue(project, project.owner_id, key, true);
    expect(await service.enqueue(project, project.owner_id, key, true)).toBe(jobId);
    await expect(service.enqueue(project, project.owner_id, 'different-key', true)).rejects.toMatchObject({ code: 'PUBLICATION_BUSY' });
    const frozen = content; content = '<head></head><body>Nouveau contenu</body>';
    await complete(jobId);
    const snap = await repository.snapshot(jobId.slice(4));
    expect(snap.files[0].content).toBe(frozen);
    const state = await service.status(project, project.owner_id);
    expect(state.public_url).toMatch(/^https:/); expect(state.has_unpublished_changes).toBe(true);
    expect(await fixture.db.query('select * from publication_invitation_outbox').then(r => r.rows)).toHaveLength(0);
  });
  it('applies invite audience only after success, preserves old alias, and does not grant editor access', async () => {
    await fixture.db.query("insert into community_listings(project_id,status) values($1,'online')", [project.id]);
    const previous = await service.status(project, project.owner_id);
    const draft = { ...previous.draft, subdomain: 'marcel-prive', audience: 'invite_only' as const, invitations: ['Invite@Example.test'] };
    await service.settings(project, project.owner_id, draft);
    expect((await service.status(project, project.owner_id)).effective?.audience).toBe('public');
    const job = await service.enqueue(project, project.owner_id, 'invitation-publish', true);
    await complete(job);
    expect((await service.status(project, project.owner_id)).effective?.audience).toBe('invite_only');
    expect((await repository.aliases(project.id)).filter(a => a.active)).toHaveLength(2);
    expect(await access.canVisit(project.id, guest)).toBe(true);
    expect(await access.canVisit(project.id, other)).toBe(false);
    expect((await fixture.db.query('select * from project_members')).rows).toHaveLength(0);
    expect((await fixture.db.query('select * from publication_invitation_outbox')).rows).toHaveLength(1);
    expect((await service.status(project, project.owner_id)).has_unpublished_changes).toBe(false);
    expect((await fixture.db.query<any>('select status from community_listings')).rows[0].status).toBe('removed_by_user');
  });
  it('uses host/project bound single-use handoff; checks invitation on every request', async () => {
    const host = 'marcel-prive.coden.test';
    const url = new URL(await access.handoff(project.id, guest, host, '/menu?jour=mercredi'));
    const code = url.searchParams.get('code')!;
    await expect(access.exchange(project.id, 'wrong.coden.test', code)).rejects.toMatchObject({ status: 403 });
    const session = await access.exchange(project.id, host, code);
    expect(session.session_token).not.toBe(code);
    await expect(access.exchange(project.id, host, code)).rejects.toMatchObject({ status: 403 });
    expect(await access.authorize(project.id, host, String(session.session_token))).toMatchObject({ allowed: true });
    expect(await access.authorize(project.id, 'other.coden.test', String(session.session_token))).toEqual({ allowed: false });
    await fixture.db.query('delete from publication_invitations where project_id=$1', [project.id]);
    expect(await access.authorize(project.id, host, String(session.session_token))).toMatchObject({ allowed: false });
    const hashes = (await fixture.db.query<any>('select token_hash from publication_visitor_sessions')).rows;
    expect(hashes[0].token_hash).toBe(tokenDigest(String(session.session_token)));
  });
  it('enforces server-only SQL grants and RLS, including source snapshots', async () => {
    await fixture.db.exec('set role authenticated');
    try { await expect(fixture.db.query('select * from publication_snapshots')).rejects.toThrow(/permission denied/); await expect(fixture.db.query("select publication_disable('10000000-0000-4000-8000-000000000001')")).rejects.toThrow(/permission denied/); }
    finally { await fixture.db.exec('reset role'); }
  });
  it('denies editor publish and fails closed when authorization cannot be checked', async () => {
    await expect(service.enqueue(project, guest, 'editor-publish', true)).rejects.toThrow('Denied');
    const broken = new PublicationAccessService({ ...access.deps, getIdentity: async () => { throw new Error('auth unavailable'); } });
    await expect(broken.canVisit(project.id, guest)).rejects.toThrow('auth unavailable');
  });
  it('does not activate an address edited after a job captured its settings', async () => {
    const state = await service.status(project, project.owner_id);
    const jobId = await service.enqueue(project, project.owner_id, 'captured-before-new-address', true);
    await service.settings(project, project.owner_id, { ...state.draft, subdomain: 'future-draft-only' });
    await complete(jobId);
    expect(await repository.knownHost(project.id, 'future-draft-only.coden.test')).toBe(false);
    expect((await service.status(project, project.owner_id)).draft.subdomain).toBe('future-draft-only');
    expect((await service.status(project, project.owner_id)).effective?.subdomain).toBe('marcel-prive');
  });
  it('rolls back content under current private settings, never old public policy/invitations', async () => {
    const initial: any = (await fixture.db.query('select id from publication_snapshots where activated order by created_at limit 1')).rows[0];
    const state = await service.status(project, project.owner_id);
    await service.settings(project, project.owner_id, { ...state.draft, subdomain: 'marcel-prive', invitations: [] });
    await complete(await service.enqueue(project, project.owner_id, 'remove-current-invitation', true));
    await service.settings(project, project.owner_id, { ...state.draft, subdomain: 'pending-after-rollback', audience: 'public', invitations: [ 'later@example.test' ] });
    brokenDraft = true;
    expect((await service.status(project, project.owner_id)).checks.some(check => check.id === 'draft')).toBe(true);
    const job = await service.rollback(project, project.owner_id, initial.id, 'safe-content-rollback');
    await complete(job);
    brokenDraft = false;
    const next = await service.status(project, project.owner_id);
    expect(next.effective?.audience).toBe('invite_only');
    expect(next.effective?.invitations).toEqual([]);
    expect(next.draft.subdomain).toBe('pending-after-rollback');
    expect(await access.canVisit(project.id, guest)).toBe(false);
  });
  it('records email failure without undoing the activated publication', async () => {
    const row: any = (await fixture.db.query('select release_id from publication_invitation_outbox limit 1')).rows[0];
    await deliverPublicationInvitations(fixture.client, row.release_id, 'https://marcel-prive.coden.test', async () => { throw new Error('simulated failure'); });
    expect((await fixture.db.query<any>('select status from publication_invitation_outbox limit 1')).rows[0].status).toBe('failed');
    expect((await repository.state(project.id))?.enabled).toBe(true);
  });
  it('SQL activation rejects a lost lease and a publisher whose membership was revoked', async () => {
    const jobId = await service.enqueue(project, project.owner_id, 'revocation-during-publication', true);
    const claim: any = (await fixture.db.query<any>("select * from claim_agent_jobs('local-test',1,60,array['publish'])")).rows[0];
    await repository.checkpoint(jobId.slice(4), { verified: true }, claim.lease_token);
    await expect(repository.checkpoint(jobId.slice(4), { candidate: { corrupt: true } }, '00000000-0000-4000-8000-000000000000')).rejects.toThrow();
    await expect(repository.activate(jobId.slice(4), 'pending-after-rollback.coden.test', '00000000-0000-4000-8000-000000000000')).rejects.toThrow();
    await fixture.db.query('update projects set owner_id=$1 where id=$2', [other, project.id]);
    await expect(repository.activate(jobId.slice(4), 'pending-after-rollback.coden.test', claim.lease_token)).rejects.toThrow();
    await fixture.db.query('update projects set owner_id=$1 where id=$2', [project.owner_id, project.id]);
    await fixture.db.query("update agent_jobs set status='failed',lease_token=null,lease_owner=null,lease_expires_at=null where id=$1", [jobId]);
    await expect(repository.checkpoint(jobId.slice(4), { artifact: { corrupt: true } }, claim.lease_token)).rejects.toThrow();
    await fixture.db.query('update agent_jobs set reconciliation_required=true,resume_count=3 where id=$1', [jobId]);
    const exhausted = await service.status(project, project.owner_id);
    expect(exhausted.active_job?.recoverable).toBe(false); expect(exhausted.active_job?.reconciliation_required).toBe(true); expect(exhausted.can_publish).toBe(false);
  });
  it('unpublishes every alias but retains original files/history', async () => {
    const legacyId = '40000000-0000-4000-8000-000000000001';
    await fixture.db.query("insert into deployments(id,project_id,provider,status) values($1,$2,'cloudflare-workers','ready')", [legacyId, project.id]);
    const retireLegacyOrigins = vi.fn(async (): Promise<void> => {
      expect((await repository.state(project.id))?.enabled).toBe(false);
      expect((await fixture.db.query<any>('select status from deployments where id=$1', [legacyId])).rows[0].status).toBe('ready');
      throw new Error('simulated legacy provider failure');
    });
    service.deps.retireLegacyOrigins = retireLegacyOrigins;
    await expect(service.unpublish(project, project.owner_id)).rejects.toThrow('simulated legacy provider failure');
    expect((await fixture.db.query<any>('select status from deployments where id=$1', [legacyId])).rows[0].status).toBe('ready');
    expect(await service.status(project, project.owner_id)).toMatchObject({ public_url: null, can_publish: false, removal_pending: true });
    await expect(service.enqueue(project, project.owner_id, 'publish-during-removal', true)).rejects.toMatchObject({ code: 'UNPUBLISH_PENDING' });
    retireLegacyOrigins.mockImplementation(async () => {
      expect((await fixture.db.query<any>('select status from deployments where id=$1', [legacyId])).rows[0].status).toBe('ready');
      await fixture.db.query("update deployments set status='removed' where id=$1", [legacyId]);
    });
    await service.unpublish(project, project.owner_id);
    expect((await service.status(project, project.owner_id)).removal_pending).toBe(false);
    expect(retireLegacyOrigins).toHaveBeenCalledTimes(2);
    expect((await fixture.db.query<any>("select count(*)::int as remaining from deployments where provider='cloudflare-workers' and status<>'removed'")).rows[0].remaining).toBe(0);
    expect(await access.authorize(project.id, 'marcel-prive.coden.test')).toEqual({ allowed: false });
    expect((await service.status(project, project.owner_id)).public_url).toBeNull();
    expect((await fixture.db.query('select * from publication_snapshots')).rows.length).toBeGreaterThan(2);
    expect((await repository.aliases(project.id)).some(a => a.active)).toBe(false);
  });
});

describe('Publication input and fingerprints', () => {
  const settings = { subdomain: 'my-project', audience: 'public' as const, invitations: [], metadata: { title: 'Application', description: '', favicon: null, image: null } };
  it('validates reserved address, workspace entitlement, asset paths and emails', () => {
    expect(() => normalizePublishSettings({ ...settings, subdomain: 'admin' }, true)).toThrow();
    expect(() => normalizePublishSettings({ ...settings, audience: 'workspace' }, false)).toThrow();
    expect(() => normalizePublishSettings({ ...settings, invitations: ['bad'] }, true)).toThrow();
    expect(() => normalizePublishSettings({ ...settings, metadata: { ...settings.metadata, image: 'https://internal/' } }, true)).toThrow();
    expect(safeReturnPath('//evil.test')).toBe('/'); expect(safeReturnPath('/\\evil')).toBe('/');
  });
  it('fingerprints content/media/config, not order, IDs or generated timestamps', () => {
    const a = { files: [{ path: 'a', content: 'x' }, { path: 'b', content: 'y', encoding: 'base64' as const }], settings, public_env: {}, manifest: { generatedAt: 'first', runtime: 'static' } };
    expect(publicationFingerprint(a)).toBe(publicationFingerprint({ ...a, files: [...a.files].reverse(), manifest: { generatedAt: 'later', runtime: 'static' } }));
    expect(publicationFingerprint(a)).not.toBe(publicationFingerprint({ ...a, settings: { ...settings, audience: 'invite_only' } }));
  });
  it('replaces metadata, escapes values, and uses live canonical address', () => {
    const html = applyPublicationMetadata('<head><title>Old</title><meta name="description" content="old"></head>', { ...settings, metadata: { ...settings.metadata, title: '<script>bad</script>', image: '/social.png' } }, 'https://app.coden.test');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('Old'); expect(html).toContain('https://app.coden.test/social.png');
  });
  it('preserves application scripts, templates, comments and body SVG titles', () => {
    const untouched = `<script>const template = '<title>JS title</title><meta name="description" content="JS">';</script><!-- <title>Comment title</title> --><template><title>Template title</title></template>`;
    const html = `<html><head><title>Actual title</title>${untouched}</head><body><svg><title>Icon label</title></svg></body></html>`;
    const next = applyPublicationMetadata(html, settings, 'https://app.coden.test', 'new-release');
    expect(next).toContain(untouched); expect(next).toContain('<title>Icon label</title>'); expect(next).not.toContain('Actual title');
  });
  it('derives metadata defaults from source without fetching remote assets', () => {
    const metadata = sourcePublicationMetadata([{ path: 'index.html', content: '<head><title>Restaurant &amp; cuisine</title><meta name="description" content="La carte"><link rel="icon" href="/icon.svg"><meta property="og:image" content="https://external.test/picture.png"></head>' }], 'Fallback');
    expect(metadata).toEqual({ title: 'Restaurant & cuisine', description: 'La carte', favicon: '/icon.svg', image: null });
  });
});
