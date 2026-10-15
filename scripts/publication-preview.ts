/** Explicit loopback simulation; never imports server.ts, .env or credentials. */
import express from 'express';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPublicationTestDatabase } from '../src/services/publication-v2/test-database.ts';
import { PublicationRepository } from '../src/services/publication-v2/repository.ts';
import { PublicationService, type PublicationProvider } from '../src/services/publication-v2/service.ts';
import { PublicationAccessService } from '../src/services/publication-v2/access.ts';
import { PublicationError } from '../src/services/publication-v2/model.ts';
import { IsolatedPublicationBuilder } from '../src/services/publication-v2/isolated-builder.ts';
import { registerPublicationV2Routes, publicationV2Publish, type PublicationRoutesDependencies } from '../src/services/publication-v2/routes.ts';
import { initJobQueue, registerJobHandler, startJobWorker, stopJobWorker, getJobStatus } from '../src/services/async-job-queue.ts';
import { createPublicationGateway, PUBLICATION_PROVIDER_VERSION, PUBLICATION_SESSION_COOKIE, type PublicationGatewayConfig } from '../src/services/publication-v2/worker-gateway.ts';
import { serializeBuiltArtifact, deserializeBuiltArtifact, type BuiltPublicationArtifact } from '../src/services/publication-v2/cloudflare-provider.ts';
import { deliverPublicationInvitations } from '../src/services/publication-v2/invitations.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.CODEN_PUBLICATION_PREVIEW_PORT || 4181);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
const origin = `http://127.0.0.1:${port}`;
const directory = path.join(root, 'artifacts/publication-v2-preview');
await fs.mkdir(directory, { recursive: true });
// New schema versions get a separate fixture DB; existing demo histories are
// retained, never deleted or modified by migration repair shortcuts.
const schema = await fs.readFile(path.join(root, 'supabase/migrations/20261015043635_publication_v2.sql'));
const { db, client } = await createPublicationTestDatabase(path.join(directory, `database-${createHash('sha256').update(schema).digest('hex').slice(0, 12)}`));
const project = { id: '10000000-0000-4000-8000-000000000001', owner_id: '20000000-0000-4000-8000-000000000001', organization_id: '30000000-0000-4000-8000-000000000001', name: 'Chez Marcel', slug: 'chez-marcel' };
const guest = '20000000-0000-4000-8000-000000000002';
const stranger = '20000000-0000-4000-8000-000000000003';
await db.query('insert into projects(id,owner_id,organization_id) values($1,$2,$3) on conflict do nothing', [project.id, project.owner_id, project.organization_id]);
const repository = new PublicationRepository(client);
let revision = 1;
const source = () => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chez Marcel</title><style>body{margin:0;background:#faf6ee;color:#29271f;font:16px/1.6 Georgia,serif;padding:40px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d9d0bf;padding-bottom:20px}h1{font-size:clamp(36px,7vw,64px);font-weight:400;line-height:1.08;max-width:12ch;margin:64px 0 24px}p{max-width:44ch}a,button{color:#fff;background:#a84d1c;border:0;border-radius:6px;padding:12px 20px;text-decoration:none;font:inherit}small{display:block;margin-top:48px;color:#675d4a}img{width:48px;height:48px}</style></head><body><header><strong>Chez Marcel</strong><span>La carte · Réserver</span></header><h1>Des produits de saison, cuisinés sans détour.</h1><p>Une cuisine de quartier, une carte courte et le plaisir de vous retrouver à table.</p><p><a href="#menu">Voir la carte</a></p><section id="menu"><h2>À la carte aujourd’hui</h2><p>Poireaux rôtis, noisettes et crème citronnée</p><p>Volaille fermière et légumes du marché</p></section><small>Projet de démonstration · version locale ${revision}</small><script src="/assets/app.js"></script></body></html>`;
const access = new PublicationAccessService({ repository, rootDomain: 'coden.test', codenOrigin: 'https://coden.test',
  getIdentity: async id => ({ id, email: id === guest ? 'invite@example.test' : id === project.owner_id ? 'owner@example.test' : 'non-invite@example.test', emailVerified: true }),
  isOwnerOrAdmin: async (_id, userId) => userId === project.owner_id, isWorkspaceMember: async (_id, userId) => userId === guest, workspaceStillAllowed: async () => true,
});
const builder = new IsolatedPublicationBuilder('coden.test', async id => (await repository.snapshot(id)).artifact);
let live: { snapshot: any; artifact: BuiltPublicationArtifact } | null = null;
const pause = () => new Promise(resolve => setTimeout(resolve, 450));
const provider: PublicationProvider = {
  async build(snapshot) { await pause(); return serializeBuiltArtifact(await builder.build(snapshot)); },
  async stage(snapshot, artifact) { await pause(); return { release: snapshot.id, artifact }; },
  async verify(snapshot, candidate) { await pause(); const built = deserializeBuiltArtifact(candidate.artifact); if (!built.assets?.some(a => a.path === '/index.html' && new TextDecoder().decode(a.bytes).includes(snapshot.id))) throw new Error('LOCAL_RELEASE_MARKER_MISSING'); },
  async activate(snapshot, candidate) { await pause(); live = { snapshot, artifact: deserializeBuiltArtifact(candidate.artifact) }; },
  async remove() { live = null; },
};
const service = new PublicationService({ repository, rootDomain: 'coden.test', provider,
  assertCanPublish: async (id, actor) => { if (id !== project.id || actor !== project.owner_id) throw new PublicationError('FORBIDDEN', 'Le compte simulé ne peut pas publier.', 403); },
  workspaceAllowed: async () => true,
  capture: async (_p, actor, settings) => ({ project_id: project.id, actor_id: actor, settings, files: [{ path: 'index.html', content: source() }, { path: 'assets/app.js', content: 'document.documentElement.dataset.codenDemo="ready";' }], manifest: { runtime: 'static-assets', outputDirectory: 'dist' }, public_env: {} }),
  checks: async () => [{ id: 'source', label: 'Fichiers du projet', status: 'pass', detail: 'Version capturée à la confirmation.' }, { id: 'security', label: 'Analyse statique', status: 'pass', detail: 'Fixture locale sans secret.' }, { id: 'simulation', label: 'Hébergement simulé', status: 'warn', detail: 'Aucun contrôle Cloudflare ou authentification externe réel.' }],
  onActivated: snapshot => deliverPublicationInvitations(client, snapshot.id, `https://${snapshot.settings.subdomain}.coden.test`, async () => { /* simulated delivery only */ }),
});
const current = await repository.state(project.id);
if (current?.enabled && current.release_id) { const snapshot = await repository.snapshot(current.release_id); if (snapshot.artifact) live = { snapshot, artifact: deserializeBuiltArtifact(snapshot.artifact) }; }
initJobQueue(client, { durable: true });
registerJobHandler('publish', async (job, progress, context) => {
  if (!context || !job.lease_token) throw new Error('LEASE_REQUIRED');
  return service.run(String(job.payload.publication_snapshot_id), progress!, { ...context, lease: job.lease_token });
});
startJobWorker();
const app = express();
app.use(express.json());
app.use((req, res, next) => { if (!['127.0.0.1', 'localhost'].includes(req.hostname)) return res.status(403).end(); res.set('Cache-Control', 'no-store'); next(); });
const actorId = (req: any) => req.get('x-preview-account') === 'guest' ? guest : req.get('x-preview-account') === 'stranger' ? stranger : project.owner_id;
const localStatus = async (actor: string) => {
  const status = await service.status(project, actor);
  return { ...status, simulation: true, public_url: status.public_url ? `${origin}/site/${status.effective!.subdomain}/` : null };
};
const deps: PublicationRoutesDependencies = { app, enabled: () => true, requireAuth: (_req: any, _res: any, next: any) => next(), project: async req => { await service.deps.assertCanPublish(project.id, actorId(req)); return project; }, actorId, service: () => service, access: () => access, getJob: getJobStatus, platformSecret: () => 'local-simulation-secret', rateLimit: () => true };
// Reuse real API handlers; translate only the fixture's public URL to loopback.
app.use('/api/projects', (_req, res, next) => { const json = res.json.bind(res); res.json = ((value: any) => { if (value?.publish) value.publish = { ...value.publish, simulation: true, public_url: value.publish.public_url ? `${origin}/site/${value.publish.effective.subdomain}/` : null }; return json(value); }) as any; next(); });
registerPublicationV2Routes(deps);
app.get('/api/projects/:id/publish/status', async (req, res) => { try { res.json({ success: true, publish: await localStatus(actorId(req)) }); } catch { res.status(503).json({ success: false, error: 'La base locale est indisponible.' }); } });
app.post('/api/projects/:id/publish', (req, res) => void publicationV2Publish(req, res, deps));
app.get('/api/jobs/:id', async (req, res) => { const job = await getJobStatus(req.params.id); if (!job || actorId(req) !== project.owner_id) return res.status(404).end(); return res.json({ success: true, job: { id: job.id, status: job.status } }); });
app.post('/preview/change', (_req, res) => { revision++; res.json({ success: true }); });
app.get('/demo', (_req, res) => res.type('html').send(source()));
app.get('/preview/identity/:account', async (req, res) => {
  const state = await repository.state(project.id);
  if (!state?.effective) return res.status(404).end();
  const userId = req.params.account === 'guest' ? guest : req.params.account === 'owner' ? project.owner_id : stranger;
  try {
    const host = `${state.effective.subdomain}.coden.test`;
    const handoff = new URL(await access.handoff(project.id, userId, host, '/'));
    const result = await access.exchange(project.id, host, handoff.searchParams.get('code')!);
    // HTTP-only loopback simulation: production Worker enforces Secure+__Host.
    res.setHeader('Set-Cookie', `coden_preview_session=${result.session_token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900`);
    return res.redirect(`/site/${state.effective.subdomain}/`);
  } catch { return res.status(403).type('html').send('<h1>Accès refusé</h1><p>Compte simulé non invité. Aucun accès à l’éditeur.</p><a href="/">Retour</a>'); }
});
app.use('/site/:subdomain', async (req: any, res: any) => {
  const host = `${req.params.subdomain}.coden.test`;
  const token = /(?:^|;\s*)coden_preview_session=([^;]+)/.exec(req.get('cookie') || '')?.[1];
  try {
    const decision = await access.authorize(project.id, host, token);
    if (!decision.allowed) return res.status(401).type('html').send('<h1>Site privé · simulation</h1><p>Choisissez un compte Coden simulé :</p><p><a href="/preview/identity/owner">Propriétaire</a> · <a href="/preview/identity/guest">Invité</a> · <a href="/preview/identity/stranger">Non invité</a></p><a href="/">Retour à Coden</a>');
    if (!live || live.snapshot.id !== decision.release_id) return res.status(503).send('Version indisponible.');
    if (host !== decision.primary_host) return res.redirect(307, `/site/${String(decision.primary_host).replace('.coden.test', '')}${req.url}`);
    const entry = live.artifact.assets?.find(a => a.path === req.path) || (req.path === '/' ? live.artifact.assets?.find(a => a.path === '/index.html') : null);
    if (!entry) return res.status(404).end();
    let bytes = Buffer.from(entry.bytes);
    if (entry.contentType.includes('text/html')) bytes = Buffer.from(bytes.toString('utf8').replaceAll('src="/assets/', `src="/site/${req.params.subdomain}/assets/`));
    return res.type(entry.contentType).send(bytes);
  } catch { return res.status(503).send('Accès non vérifiable. Réessayez.'); }
});
app.get('/api/jobs/:id/events', async (req, res) => {
  const job = await getJobStatus(req.params.id);
  if (!job || actorId(req) !== project.owner_id) return res.status(404).end();
  let after = Number(req.get('Last-Event-ID') || req.query.after || 0);
  if (!Number.isSafeInteger(after) || after < 0) return res.status(400).end();
  res.set('Content-Type', 'text/event-stream');
  const poll = async () => { const { rows } = await db.query<any>('select sequence,step,message from agent_job_events where job_id=$1 and sequence>$2 order by sequence', [job.id, after]); for (const row of rows) { after = Number(row.sequence); res.write(`id: ${after}\ndata: ${JSON.stringify(row)}\n\n`); } };
  const timer = setInterval(() => void poll(), 300);
  res.on('close', () => clearInterval(timer));
  await poll();
});
const vite = await createServer({ root, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
app.get('/', async (_req, res) => res.type('html').send(await vite.transformIndexHtml('/publication-preview.html', await fs.readFile(path.join(root, 'scripts/publication-preview.fixture'), 'utf8'))));
app.use(vite.middlewares);
const server = app.listen(port, '127.0.0.1', () => console.log(`Publication preview (SIMULATED): ${origin}`));
async function shutdown() { stopJobWorker(); server.close(); await vite.close(); await db.close(); }
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
