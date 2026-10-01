/**
 * HTTP routes of the Community. Thin on purpose: each handler authenticates, limits the rate, validates its input, calls
 * the service and answers; the rules live in the service and the pure modules.
 *
 * Every route answers 404 when the Community is off or hidden, so a disabled feature looks like a page that does not exist.
 */
import type { Express } from 'express';
import { REPORT_REASONS } from './rules.ts';
import { CommunityError, type CommunityService } from './service.ts';
import type { ListTab } from './store.ts';

export type RouteDeps = {
  app: Express;
  service: CommunityService;
  requireAuth: (req: any, res: any, next: any) => any;
  authUser: (req: any, res: any) => { id: string; email?: string | null } | null;
  optionalUserId: (req: any) => string | null;
  enforceRateLimit: (key: string, limit: number, windowMs: number) => boolean;
  requirePlatformAdmin: (req: any, res: any) => boolean;
  adminMutationAllowed: (req: any, res: any, bucket: string, limit: number, windowMs?: number) => boolean;
  recordAdminAudit: (req: any, action: string, target: { type?: string; id?: string | null }, detail?: Record<string, unknown>) => Promise<void>;
  getOrganizationPlan: (organizationId: string) => Promise<string>;
  ensureOrganization: (req: any, userId: string) => Promise<string>;
  loadProjectOwned: (projectId: string, userId: string, req?: any) => Promise<any | null>;
  publicOrigin: (req: any) => string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

export function registerCommunityRoutes(deps: RouteDeps): void {
  const { app, service } = deps;

  const fail = (res: any, error: unknown) => {
    if (error instanceof CommunityError) return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    console.error('[coden:community_error]', { message: String((error as any)?.message || error).slice(0, 200) });
    return res.status(500).json({ success: false, error: 'La Communauté est momentanément indisponible. Réessayez dans un instant.', code: 'COMMUNITY_ERROR' });
  };
  const idParam = (req: any) => (UUID.test(String(req.params.id || '')) ? String(req.params.id) : null);
  const handler = (name: string, limit: [number, number] | null, run: (req: any, res: any, user: { id: string }) => Promise<unknown>) => async (req: any, res: any) => {
    try {
      const user = deps.authUser(req, res);
      if (!user) return;
      if (limit && !deps.enforceRateLimit(`community:${name}:${user.id}`, limit[0], limit[1])) {
        return res.status(429).json({ success: false, error: 'Trop de demandes à la suite : réessayez dans un instant.', code: 'RATE_LIMITED' });
      }
      await run(req, res, user);
    } catch (error) { fail(res, error); }
  };

  // ── Public: thumbnails and the shareable page (no sign-in: they are what a link preview and a search engine see) ──
  app.get('/api/community/listings/:id/thumbnail', async (req: any, res: any) => {
    try {
      const id = idParam(req);
      if (!id) return res.status(404).end();
      await service.ensureVisible();
      const image = await service.thumbnail(id);
      if (!image) return res.status(404).end();
      if (req.headers['if-none-match'] === image.etag) return res.status(304).end();
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      res.setHeader('ETag', image.etag);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(image.buffer);
    } catch { res.status(404).end(); }
  });

  /*
   * The shareable page of an app: title, description, thumbnail, creator, and a way in. Share metadata (Open Graph) is
   * always present; the page is indexable only once the app has passed its checks and is online, otherwise it says nothing.
   */
  app.get('/c/:id', async (req: any, res: any) => {
    const notFound = () => res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Introuvable</title><p>Cette app n’est plus disponible dans la Communauté.</p>');
    try {
      const id = idParam(req);
      if (!id) return notFound();
      const { listing } = await service.detail(id, null);
      const origin = deps.publicOrigin(req);
      const image = listing.thumbnail ? `${origin}${listing.thumbnail}` : '';
      const url = `${origin}/c/${listing.id}`;
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.type('html').send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(listing.title)} — Communauté Coden</title>
<meta name="description" content="${esc((listing.description || `Une app créée avec Coden par ${listing.creator}.`).slice(0, 160))}">
<meta name="robots" content="${listing.indexable ? 'index,follow' : 'noindex,nofollow'}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Coden"><meta property="og:title" content="${esc(listing.title)}">
<meta property="og:description" content="${esc((listing.description || `Une app créée avec Coden par ${listing.creator}.`).slice(0, 200))}"><meta property="og:url" content="${esc(url)}">
${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(image)}">` : '<meta name="twitter:card" content="summary">'}
<meta http-equiv="refresh" content="0; url=/dashboard.html#community/${esc(listing.id)}">
<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;padding:24px}main{max-width:520px;text-align:center}img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:12px}a{color:inherit}</style></head>
<body><main>${image ? `<img src="${esc(image)}" alt="${esc(`Aperçu de « ${listing.title} »`)}" width="800" height="500">` : ''}<h1>${esc(listing.title)}</h1><p>${esc(listing.description)}</p><p>Par ${esc(listing.creator)} · <a href="/dashboard.html#community/${esc(listing.id)}">Ouvrir dans Coden</a></p></main></body></html>`);
    } catch { notFound(); }
  });

  app.use('/api/community', deps.requireAuth);

  // ── The sidebar asks once: is the Community on for everyone? ──
  app.get('/api/community/config', handler('config', [120, 60_000], async (_req, res) => {
    const current = await service.switches();
    res.setHeader('Cache-Control', 'private, max-age=30');
    res.json({ success: true, enabled: current.enabled && !current.hidden, frozen: current.frozen, reportReasons: REPORT_REASONS });
  }));

  app.get('/api/community/categories', handler('categories', [60, 60_000], async (_req, res) => {
    await service.ensureVisible();
    res.json({ success: true, categories: await service.store().categories() });
  }));

  app.get('/api/community/listings', handler('list', [180, 60_000], async (req, res, user) => {
    const tab = (['discover', 'trending', 'recent'].includes(String(req.query.tab)) ? String(req.query.tab) : 'discover') as ListTab;
    const result = await service.list({ tab, category: req.query.category ? String(req.query.category).slice(0, 60) : undefined, q: req.query.q ? String(req.query.q).slice(0, 80) : undefined, cursor: req.query.cursor ? String(req.query.cursor).slice(0, 80) : null, limit: Number(req.query.limit) || 24, viewer: user.id });
    res.setHeader('Cache-Control', 'private, max-age=15');
    res.json({ success: true, ...result });
  }));

  app.get('/api/community/listings/:id', handler('detail', [180, 60_000], async (req, res, user) => {
    const id = idParam(req);
    if (!id) throw new CommunityError(404, 'Cette app n’est plus disponible dans la Communauté.', 'NOT_FOUND');
    res.setHeader('Cache-Control', 'private, max-age=15');
    res.json({ success: true, ...(await service.detail(id, user.id)) });
  }));

  app.post('/api/community/listings/:id/view', handler('view', [60, 60_000], async (req, res, user) => {
    const id = idParam(req);
    if (!id) throw new CommunityError(404, 'Introuvable.', 'NOT_FOUND');
    res.json({ success: true, ...(await service.recordView(id, { userId: user.id, ip: String(req.ip || ''), agent: String(req.headers['user-agent'] || '') })) });
  }));

  app.post('/api/community/listings/:id/like', handler('like', [30, 60_000], async (req, res, user) => {
    const id = idParam(req);
    if (!id) throw new CommunityError(404, 'Introuvable.', 'NOT_FOUND');
    res.json({ success: true, ...(await service.like(user.id, id)) });
  }));

  app.post('/api/community/listings/:id/report', handler('report', [10, 60 * 60_000], async (req, res, user) => {
    const id = idParam(req);
    if (!id) throw new CommunityError(404, 'Introuvable.', 'NOT_FOUND');
    res.json({ success: true, ...(await service.report(user.id, id, req.body?.reason, req.body?.details)) });
  }));

  app.post('/api/community/listings/:id/remix', handler('remix', [12, 60_000], async (req, res, user) => {
    const id = idParam(req);
    if (!id) throw new CommunityError(404, 'Introuvable.', 'NOT_FOUND');
    res.json({ success: true, ...(await service.remix(user.id, id, req)) });
  }));

  app.post('/api/community/listings/:id/appeal', handler('appeal', [5, 60 * 60_000], async (req, res, user) => {
    const id = idParam(req);
    if (!id) throw new CommunityError(404, 'Introuvable.', 'NOT_FOUND');
    res.json({ success: true, ...(await service.appeal(user.id, id, String(req.body?.message || ''))) });
  }));

  // ── Templates ──
  app.get('/api/community/templates', handler('templates', [60, 60_000], async (req, res, user) => {
    const plan = await deps.getOrganizationPlan(await deps.ensureOrganization(req, user.id));
    res.json({ success: true, templates: await service.templates(plan) });
  }));

  app.post('/api/community/templates/:slug/use', handler('template-use', [20, 60_000], async (req, res, user) => {
    const slug = String(req.params.slug || '').slice(0, 80);
    if (!/^[a-z0-9-]+$/.test(slug)) throw new CommunityError(404, 'Ce template n’existe pas.', 'NOT_FOUND');
    const plan = await deps.getOrganizationPlan(await deps.ensureOrganization(req, user.id));
    res.json({ success: true, ...(await service.useTemplate(user.id, slug, plan, req)) });
  }));

  app.post('/api/community/templates/:slug/project', handler('template-project', [20, 60_000], async (req, res, user) => {
    const slug = String(req.params.slug || '').slice(0, 80);
    const projectId = String(req.body?.projectId || '');
    if (!/^[a-z0-9-]+$/.test(slug) || !UUID.test(projectId)) throw new CommunityError(400, 'Requête invalide.', 'INVALID');
    // Only a project the person owns can be recorded as made from a template.
    if (!(await deps.loadProjectOwned(projectId, user.id, req))) throw new CommunityError(404, 'Projet introuvable.', 'NOT_FOUND');
    await service.recordTemplateProject(user.id, slug, projectId);
    res.json({ success: true });
  }));

  // ── The owner: « Mes publications » ──
  app.get('/api/community/mine', handler('mine', [60, 60_000], async (req, res, user) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...(await service.mine(user.id, await deps.ensureOrganization(req, user.id))) });
  }));

  app.get('/api/community/projects/:projectId/publish-info', handler('publish-info', [60, 60_000], async (req, res, user) => {
    const projectId = String(req.params.projectId || '');
    if (!UUID.test(projectId)) throw new CommunityError(404, 'Projet introuvable.', 'NOT_FOUND');
    const project = await deps.loadProjectOwned(projectId, user.id, req);
    if (!project) throw new CommunityError(404, 'Projet introuvable.', 'NOT_FOUND');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...(await service.publishInfo(user.id, projectId, project.organization_id)) });
  }));

  app.patch('/api/community/projects/:projectId/listing', handler('listing-edit', [30, 60_000], async (req, res, user) => {
    const projectId = String(req.params.projectId || '');
    if (!UUID.test(projectId)) throw new CommunityError(404, 'Projet introuvable.', 'NOT_FOUND');
    const project = await deps.loadProjectOwned(projectId, user.id, req);
    if (!project) throw new CommunityError(404, 'Projet introuvable.', 'NOT_FOUND');
    const body = req.body || {};
    res.json({ success: true, listing: await service.updateListing(user.id, projectId, project.organization_id, { title: body.title, description: body.description, category: body.category, creatorAlias: body.creatorAlias, optedIn: body.optedIn, remixable: body.remixable }, req) });
  }));

  app.post('/api/community/projects/:projectId/offer', handler('offer', [20, 60_000], async (req, res, user) => {
    const projectId = String(req.params.projectId || '');
    const answer = String(req.body?.answer || '');
    if (!UUID.test(projectId) || !['accept', 'later', 'declined'].includes(answer)) throw new CommunityError(400, 'Requête invalide.', 'INVALID');
    const project = await deps.loadProjectOwned(projectId, user.id, req);
    if (!project) throw new CommunityError(404, 'Projet introuvable.', 'NOT_FOUND');
    res.json({ success: true, result: await service.answerOffer(user.id, projectId, project.organization_id, answer as 'accept' | 'later' | 'declined', req) });
  }));

  app.post('/api/community/projects/:projectId/thumbnail/refresh', handler('thumb-refresh', [4, 60 * 60_000], async (req, res, user) => {
    const projectId = String(req.params.projectId || '');
    if (!UUID.test(projectId)) throw new CommunityError(404, 'Projet introuvable.', 'NOT_FOUND');
    res.json({ success: true, ...(await service.refreshThumbnail(user.id, projectId, req)) });
  }));

  app.get('/api/community/projects/:projectId/origin', handler('origin', [60, 60_000], async (req, res, user) => {
    const projectId = String(req.params.projectId || '');
    if (!UUID.test(projectId)) throw new CommunityError(404, 'Projet introuvable.', 'NOT_FOUND');
    res.json({ success: true, origin: await service.remixOrigin(projectId, user.id) });
  }));

  app.post('/api/community/upgrade-click', handler('upgrade-click', [10, 60 * 60_000], async (req, res, user) => {
    await service.ensureVisible();
    await service.recordUpgradeClick(user.id, String(req.body?.from || 'community'));
    res.json({ success: true });
  }));

  app.put('/api/community/profile', handler('profile', [10, 60_000], async (req, res, user) => {
    await service.ensureVisible();
    const name = String(req.body?.displayName || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40);
    const bio = String(req.body?.bio || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 200);
    const checked = await service.validateProfileText(`${name}\n${bio}`);
    if (!checked.ok) throw new CommunityError(422, checked.reason, 'TEXT_REFUSED');
    await service.store().saveProfile(user.id, { display_name: name || null, bio: bio || null, public: Boolean(req.body?.public) });
    res.json({ success: true });
  }));

  // ── Admin ──
  app.get('/api/admin/community', async (req: any, res: any) => {
    try {
      if (!deps.requirePlatformAdmin(req, res)) return;
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, ...(await service.adminOverview()) });
    } catch (error) { fail(res, error); }
  });

  app.get('/api/admin/community/listings', async (req: any, res: any) => {
    try {
      if (!deps.requirePlatformAdmin(req, res)) return;
      res.json({ success: true, listings: await service.store().adminListings(req.query.status ? String(req.query.status).slice(0, 40) : null) });
    } catch (error) { fail(res, error); }
  });

  app.post('/api/admin/community/switch', async (req: any, res: any) => {
    try {
      if (!deps.requirePlatformAdmin(req, res) || !deps.adminMutationAllowed(req, res, 'community-switch', 20)) return;
      const key = String(req.body?.key || '');
      if (key !== 'hidden' && key !== 'frozen') return res.status(400).json({ success: false, error: 'Interrupteur inconnu.' });
      const value = Boolean(req.body?.value);
      await service.setSwitch(key, value, String(deps.optionalUserId(req) || ''));
      await deps.recordAdminAudit(req, 'community.switch', { type: 'community', id: key }, { value });
      res.json({ success: true, switches: await service.switches(true) });
    } catch (error) { fail(res, error); }
  });

  app.post('/api/admin/community/listings/:id/action', async (req: any, res: any) => {
    try {
      if (!deps.requirePlatformAdmin(req, res) || !deps.adminMutationAllowed(req, res, 'community-action', 60)) return;
      const id = idParam(req);
      const action = String(req.body?.action || '');
      if (!id || !['remove', 'restore', 'feature', 'unfeature', 'dismiss_reports'].includes(action)) return res.status(400).json({ success: false, error: 'Requête invalide.' });
      const adminId = String(deps.optionalUserId(req) || '');
      const result = await service.adminAction(id, action as any, adminId, String(req.body?.reason || '').slice(0, 300), Boolean(req.body?.sanction));
      await deps.recordAdminAudit(req, `community.${action}`, { type: 'community_listing', id }, { reason: String(req.body?.reason || '').slice(0, 300) });
      res.json({ success: true, listing: result });
    } catch (error) { fail(res, error); }
  });

  app.post('/api/admin/community/appeals/:id', async (req: any, res: any) => {
    try {
      if (!deps.requirePlatformAdmin(req, res) || !deps.adminMutationAllowed(req, res, 'community-appeal', 60)) return;
      const id = idParam(req);
      const decision = String(req.body?.decision || '');
      if (!id || !['accepted', 'declined'].includes(decision)) return res.status(400).json({ success: false, error: 'Requête invalide.' });
      const adminId = String(deps.optionalUserId(req) || '');
      await service.resolveAppeal(id, decision as 'accepted' | 'declined', adminId);
      await deps.recordAdminAudit(req, 'community.appeal', { type: 'community_appeal', id }, { decision });
      res.json({ success: true });
    } catch (error) { fail(res, error); }
  });
}
