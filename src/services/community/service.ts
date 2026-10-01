/**
 * The Community, as the rest of Coden uses it.
 *
 * `server.ts` hands this module the few things it already owns (the database, projects, plans, e-mail) and gets back
 * the operations: a publication arrives, an app is taken down, a plan changes, a visitor likes, reports or remixes.
 * Every rule lives in the pure modules next to it; this file only connects them to storage and to the clock.
 */
import { createHash } from 'node:crypto';
import { classifyCategory, isKnownCategory } from './categories.ts';
import { findPersonalData, moderateText, type SourceFile, type Verdict } from './checks.ts';
import { inspectPublicPage, type Inspection } from './inspector.ts';
import { runListingChecks, visibilityForListing, type PipelineDeps, type VisionVerdict } from './pipeline.ts';
import { attributionNote, neutralizeConnections, reconnectList, remixMetadata, selectRemixFiles, type Reconnect } from './remix.ts';
import { communityVisible, isReportReason, nextSanction, readEnvSwitches, readLimits, remixAllowed, reportsAction, trendingScore, type CommunitySwitches } from './rules.ts';
import { ANONYMOUS_CREATOR, CommunityStore, STATUS_LABELS, type ListingRow, type ListTab } from './store.ts';
import { OFFICIAL_TEMPLATES } from './templates.ts';
import { decideListing, FREE_PUBLISH_NOTICE, graceEndsAt, ownerControls, PAID_PUBLISH_NOTICE, planKind } from './visibility.ts';

export type PublishedSnapshot = { publicUrl: string; deploymentId: string | null; artifactHash: string | null; files: SourceFile[] };

export type CommunityContext = {
  getSupabase: () => any | null;
  getOrganizationPlan: (organizationId: string) => Promise<string>;
  /** The latest live version of a project: its public address and the files that were published. `null` when it is not published. */
  loadPublishedSnapshot: (projectId: string) => Promise<PublishedSnapshot | null>;
  /** Projects of a person that are published right now. */
  listPublishedProjects: (ownerId: string) => Promise<Array<{ projectId: string; organizationId: string }>>;
  loadProjectOwned: (projectId: string, userId: string, req?: any) => Promise<any | null>;
  /** Creates a project for the person from files, and returns it. */
  createProjectFromFiles: (input: { userId: string; req?: any; name: string; prompt: string; template?: string; theme?: string; files: SourceFile[]; reason: string; meta: Record<string, unknown> }) => Promise<{ id: string; name: string }>;
  accountCreatedAt: (userId: string) => Promise<string | null>;
  sendUserEmail: (userId: string, subject: string, text: string) => Promise<boolean>;
  /** A vision model verdict on a screenshot: only used when the text left a doubt. */
  moderateImage?: (image: Buffer, context: { title: string; categories: string[] }) => Promise<VisionVerdict>;
  log?: (event: string, data?: Record<string, unknown>) => void;
  env?: Record<string, string | undefined>;
  inspect?: (url: string) => Promise<Inspection>;
};

export type OwnerListingView = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  category: string;
  creatorAlias: string | null;
  status: string;
  statusLabel: string;
  statusReason: string | null;
  statusCode: string | null;
  origin: 'free_auto' | 'paid_opt_in';
  optedIn: boolean;
  remixable: boolean;
  featured: boolean;
  qualityScore: number | null;
  stats: { views: number; likes: number; remixes: number };
  thumbnail: string | null;
  canContest: boolean;
  updatedAt: string;
};

export class CommunityError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = 'COMMUNITY_ERROR') { super(message); }
}

const MAX_SNAPSHOT_CHARS = 3_000_000;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

export function createCommunityService(ctx: CommunityContext) {
  const env = ctx.env || process.env;
  const limits = readLimits(env);
  const envSwitches = readEnvSwitches(env);
  const log = ctx.log || (() => undefined);
  let storeInstance: CommunityStore | null = null;
  let switchCache: { at: number; value: CommunitySwitches } | null = null;

  const store = (): CommunityStore => {
    const client = ctx.getSupabase();
    if (!client) throw new CommunityError(503, 'La Communauté n’est pas disponible pour le moment.', 'COMMUNITY_UNAVAILABLE');
    storeInstance ??= new CommunityStore(client);
    return storeInstance;
  };

  /** The flag and both kill switches, re-read at most every 15 seconds so a switch takes effect quickly without hammering the database. */
  async function switches(force = false): Promise<CommunitySwitches> {
    if (!envSwitches.enabled) return { enabled: false, hidden: false, frozen: false, bonusCredits: false };
    if (!force && switchCache && Date.now() - switchCache.at < 15_000) return switchCache.value;
    let hidden = envSwitches.hiddenByEnv;
    let frozen = envSwitches.frozenByEnv;
    try {
      const db = await store().settings();
      hidden ||= db.hidden;
      frozen ||= db.frozen;
    } catch (error: any) {
      // If the switches cannot be read, the safe answer is « hidden »: an unreadable kill switch must never leave the feature open.
      log('switch_read_failed', { message: String(error?.message || error).slice(0, 120) });
      hidden = true;
    }
    const value = { enabled: true, hidden, frozen, bonusCredits: envSwitches.bonusCredits };
    switchCache = { at: Date.now(), value };
    return value;
  }

  async function ensureVisible(): Promise<CommunitySwitches> {
    const current = await switches();
    if (!communityVisible(current)) throw new CommunityError(404, 'Cette page n’existe pas.', 'COMMUNITY_OFF');
    return current;
  }

  // ── The pipeline, wired to the real world ──────────────────────────────────────────────────────────────────────
  async function applySanction(ownerId: string, reason: string): Promise<void> {
    const s = store();
    const sanction = nextSanction(await s.upheldCount(ownerId));
    const until = sanction.days ? new Date(Date.now() + sanction.days * 86_400_000).toISOString() : null;
    await s.addSanction({ user_id: ownerId, level: sanction.level, reason, until });
    await s.journal({ actor_type: 'system', actor_id: ownerId, event: `sanction_${sanction.level}`, reason, data: { until } });
    const label = sanction.level === 'warning' ? 'un avertissement' : sanction.level === 'suspension' ? `une suspension de ${sanction.days} jours` : 'une exclusion de la Communauté';
    await ctx.sendUserEmail(ownerId, 'Une de vos apps a été retirée de la Communauté Coden', `Une de vos apps ne respecte pas les règles de la Communauté et en a été retirée (${reason}).\n\nCela entraîne ${label} pour vos ajouts à la Communauté. Votre compte, vos projets et vos publications ne sont pas affectés.\n\nVous pouvez contester cette décision depuis « Mes publications », dans la Communauté.`).catch(() => false);
  }

  async function pipelineDeps(options: { strict?: boolean } = {}): Promise<PipelineDeps> {
    const s = store();
    const current = await switches();
    return {
      store: s,
      inspect: ctx.inspect || (address => inspectPublicPage(address)),
      moderateImage: ctx.moderateImage,
      strict: options.strict,
      saveThumbnail: async (listingId, versionId, image) => {
        const client = ctx.getSupabase();
        const path = `${listingId}/${versionId}.webp`;
        const { error } = await client.storage.from('community-thumbs').upload(path, image, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' });
        if (error) { log('thumbnail_upload_failed', { message: error.message }); return null; }
        return path;
      },
      notifyOwner: async (listing: ListingRow, verdict: Verdict) => {
        const subject = verdict.state === 'refused' ? `« ${listing.title} » n’a pas été ajoutée à la Communauté` : `« ${listing.title} » demande une correction avant d’apparaître dans la Communauté`;
        await ctx.sendUserEmail(listing.owner_id, subject, `${verdict.reason}\n\n${verdict.remedy || ''}\n\nVotre app reste publiée : seule son apparition dans la Communauté est concernée. Le détail est dans « Mes publications ».`.trim());
      },
      currentVisibility: async listing => {
        const snapshot = await ctx.loadPublishedSnapshot(listing.project_id).catch(() => null);
        const plan = listing.organization_id ? await ctx.getOrganizationPlan(listing.organization_id) : 'free';
        const notice = await s.openNotice(listing.owner_id).catch(() => null);
        return visibilityForListing(listing, { published: Boolean(snapshot), plan, frozen: current.frozen, autoListNotBefore: notice?.effective_at || null });
      },
      accountCreatedAt: ctx.accountCreatedAt,
      onUpheld: async listing => { await s.resolveReports(listing.id, 'upheld'); await applySanction(listing.owner_id, 'contenu non conforme'); },
      onCleared: async listing => { await s.resolveReports(listing.id, 'dismissed'); },
      limits,
    };
  }

  // One check at a time: each opens a browser. Pending work is durable in the database, so a restart loses nothing.
  let chain: Promise<unknown> = Promise.resolve();
  let queued = 0;
  function enqueue(listingId: string, versionId: string, options: { strict?: boolean } = {}): void {
    queued += 1;
    chain = chain.then(async () => {
      try {
        const outcome = await runListingChecks(await pipelineDeps(options), listingId, versionId);
        log('listing_checked', { listingId, outcome: outcome.kind });
      } catch (error: any) {
        log('listing_check_failed', { listingId, message: String(error?.message || error).slice(0, 200) });
      } finally { queued -= 1; }
    });
  }

  // ── Publication hooks ───────────────────────────────────────────────────────────────────────────────────────────
  function cleanTitle(value: string): string {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Mon app';
  }

  /**
   * An app was just published (or republished). Decides, with the one rule, whether it enters the Community, and if so
   * puts it in the queue. Never throws into the publication: the caller wraps it, and a failure here is only logged.
   */
  async function onPublished(input: { project: { id: string; name: string; owner_id: string; organization_id: string; prompt?: string }; snapshot: PublishedSnapshot; plan?: string }): Promise<{ listed: boolean; code: string; reason: string }> {
    const current = await switches();
    if (!current.enabled) return { listed: false, code: 'community_off', reason: '' };
    const s = store();
    const { project, snapshot } = input;
    const plan = input.plan ?? await ctx.getOrganizationPlan(project.organization_id);
    const existing = await s.byProject(project.id);
    const notice = await s.openNotice(project.owner_id);
    const decision = decideListing({
      published: true, plan, optedIn: existing?.opted_in, removedByModeration: existing?.status === 'removed_by_moderation',
      listingsFrozen: current.frozen, alreadyListed: existing?.status === 'online', autoListNotBefore: notice?.effective_at || null,
    });
    if (!decision.listable) {
      if (existing && (existing.status === 'online' || existing.status === 'pending') && decision.code !== 'listings_frozen') {
        await s.transition(existing, 'removed_by_user', { actor: 'system', event: 'visibility_changed', code: decision.code, reason: decision.reason });
      }
      return { listed: false, code: decision.code, reason: decision.reason };
    }
    const oversized = snapshot.files.reduce((sum, file) => sum + file.content.length, 0) > MAX_SNAPSHOT_CHARS;
    let listing = existing;
    if (!listing) {
      const category = classifyCategory({ title: input.project.name, description: input.project.prompt || '' }, (await s.categories()).map(item => item.slug));
      listing = await s.create({
        project_id: project.id, owner_id: project.owner_id, organization_id: project.organization_id, title: cleanTitle(project.name), description: '', category: category.slug,
        origin: decision.origin || 'free_auto', opted_in: decision.origin === 'paid_opt_in', remixable: !oversized, status: 'pending', public_url: snapshot.publicUrl,
      });
      await s.journal({ listing_id: listing.id, project_id: project.id, actor_type: 'system', event: 'submitted', to_status: 'pending', code: decision.code, reason: decision.reason, data: { plan, origin: decision.origin } });
    } else {
      const restart = listing.status !== 'online' && listing.status !== 'hidden';
      listing = restart
        ? await s.transition(listing, 'pending', { actor: 'system', event: 'resubmitted', code: decision.code, reason: decision.reason, patch: { public_url: snapshot.publicUrl, origin: decision.origin || listing.origin } as Partial<ListingRow> })
        : listing;
      await s.journal({ listing_id: listing.id, project_id: project.id, actor_type: 'system', event: 'republished', code: decision.code, reason: 'Nouvelle version publiée : l’ancienne reste visible jusqu’à la fin des vérifications.' });
    }
    const versionId = await s.createVersion({ listing_id: listing.id, deployment_id: snapshot.deploymentId, artifact_hash: snapshot.artifactHash, public_url: snapshot.publicUrl, files: oversized ? [] : snapshot.files });
    enqueue(listing.id, versionId);
    return { listed: true, code: decision.code, reason: decision.reason };
  }

  /** The app was unpublished or its project deleted: it leaves the Community at once. */
  async function onUnpublished(projectId: string, actor: { id: string | null; type: 'user' | 'system' } = { id: null, type: 'user' }): Promise<void> {
    if (!envSwitches.enabled) return;
    const s = store();
    const listing = await s.byProject(projectId);
    if (!listing || listing.status === 'removed_by_user' || listing.status === 'removed_by_moderation') return;
    await s.transition(listing, 'removed_by_user', { actor: actor.type, actorId: actor.id, event: 'unpublished', code: 'not_published', reason: 'L’app a été dépubliée : elle a quitté la Communauté.', patch: { indexable: false, featured: false } as Partial<ListingRow> });
  }

  /** The account is being erased: every trace in the Community goes with it. Remixed copies belong to other people and stay. */
  async function purgeUser(userId: string): Promise<void> {
    if (!envSwitches.enabled && !ctx.getSupabase()) return;
    const client = ctx.getSupabase();
    if (!client) return;
    const s = store();
    for (const listing of await s.mine(userId)) {
      await s.journal({ listing_id: listing.id, project_id: listing.project_id, actor_type: 'user', actor_id: userId, event: 'account_erased', code: 'account_erased', reason: 'Compte supprimé.' });
      if (listing.thumbnail_path) await client.storage.from('community-thumbs').remove([listing.thumbnail_path]).catch(() => undefined);
    }
    await client.from('community_listings').delete().eq('owner_id', userId);
    await client.from('community_likes').delete().eq('user_id', userId);
    await client.from('community_reports').delete().eq('reporter_id', userId);
    await client.from('community_appeals').delete().eq('user_id', userId);
    await client.from('community_profiles').delete().eq('user_id', userId);
    await client.from('community_plan_notices').delete().eq('owner_id', userId);
    await client.from('community_remixes').update({ user_id: '00000000-0000-0000-0000-000000000000' }).eq('user_id', userId);
  }

  // ── Plan changes ────────────────────────────────────────────────────────────────────────────────────────────────
  async function onPlanChanged(input: { ownerId: string; organizationId: string; from: string; to: string }): Promise<void> {
    if (!envSwitches.enabled) return;
    const s = store();
    const before = planKind(input.from);
    const after = planKind(input.to);
    if (before === after) return;
    if (after === 'paid') {
      // Free → paid: nothing changes by itself. Apps already listed stay listed (they count as chosen) until the owner decides.
      await s.cancelNotice(input.ownerId);
      const listings = (await s.mine(input.ownerId)).filter(listing => listing.status === 'online' || listing.status === 'pending');
      for (const listing of listings) {
        await s.update(listing.id, { opted_in: true, origin: 'paid_opt_in' } as Partial<ListingRow>);
        await s.journal({ listing_id: listing.id, project_id: listing.project_id, actor_type: 'system', event: 'plan_upgrade_kept', code: 'plan_upgrade', reason: 'Passage à un plan payant : l’app reste dans la Communauté jusqu’à votre choix.' });
      }
      return;
    }
    if (after === 'free') {
      if (await s.openNotice(input.ownerId)) return;
      const published = await ctx.listPublishedProjects(input.ownerId);
      const waiting: string[] = [];
      for (const item of published) {
        const listing = await s.byProject(item.projectId);
        if (!listing || listing.status === 'removed_by_user') waiting.push(item.projectId);
      }
      if (!waiting.length) return;
      const effective = graceEndsAt(new Date()).toISOString();
      const id = await s.createNotice({ owner_id: input.ownerId, organization_id: input.organizationId, effective_at: effective });
      await s.journal({ actor_type: 'system', actor_id: input.ownerId, event: 'downgrade_notice', code: 'grace_period', reason: 'Passage au plan gratuit : préavis de 14 jours avant l’ajout automatique.', data: { apps: waiting.length, effective_at: effective } });
      const sent = await ctx.sendUserEmail(input.ownerId, 'Vos apps publiées apparaîtront dans la Communauté Coden dans 14 jours', `Vous êtes passé au plan gratuit. Sur ce plan, les apps publiées apparaissent dans la Communauté Coden.\n\nVous avez 14 jours : ${waiting.length} de vos apps publiées, jusqu’ici gardées privées, y apparaîtront à partir du ${new Date(effective).toLocaleDateString('fr-FR')}.\n\nPour garder le choix, repassez à un plan payant. Vous pouvez aussi dépublier une app, ou modifier son titre, sa description et sa catégorie dans « Mes publications ».`).catch(() => false);
      if (sent) await s.markNoticeNotified(id);
    }
  }

  async function applyDueNotices(): Promise<number> {
    const s = store();
    let applied = 0;
    for (const notice of await s.dueNotices()) {
      try {
        const plan = notice.organization_id ? await ctx.getOrganizationPlan(notice.organization_id) : 'free';
        if (planKind(plan) === 'free') {
          for (const item of await ctx.listPublishedProjects(notice.owner_id)) {
            const snapshot = await ctx.loadPublishedSnapshot(item.projectId);
            if (!snapshot) continue;
            const project = await ctx.loadProjectOwned(item.projectId, notice.owner_id);
            if (project) await onPublished({ project, snapshot, plan });
          }
          applied += 1;
        }
        await s.markNoticeApplied(notice.id);
      } catch (error: any) { log('notice_failed', { id: notice.id, message: String(error?.message || error).slice(0, 160) }); }
    }
    return applied;
  }

  // ── Owner screens ───────────────────────────────────────────────────────────────────────────────────────────────
  function ownerView(row: ListingRow): OwnerListingView {
    return {
      id: row.id, projectId: row.project_id, title: row.title, description: row.description, category: row.category, creatorAlias: row.creator_alias,
      status: row.status, statusLabel: STATUS_LABELS[row.status], statusReason: row.status_reason, statusCode: row.status_code, origin: row.origin, optedIn: row.opted_in,
      remixable: row.remixable, featured: row.featured, qualityScore: row.quality_score, stats: { views: row.view_count, likes: row.like_count, remixes: row.remix_count },
      thumbnail: row.thumbnail_path ? `/api/community/listings/${row.id}/thumbnail?v=${encodeURIComponent(row.updated_at.replace(/\D/g, '').slice(0, 14))}` : null,
      canContest: row.status === 'refused' || row.status === 'needs_fix' || row.status === 'removed_by_moderation', updatedAt: row.updated_at,
    };
  }

  async function mine(userId: string, organizationId: string) {
    await ensureVisible();
    const s = store();
    const plan = await ctx.getOrganizationPlan(organizationId);
    const [rows, notice, published] = await Promise.all([s.mine(userId), s.openNotice(userId), ctx.listPublishedProjects(userId)]);
    const listed = new Set(rows.map(row => row.project_id));
    return {
      plan, controls: ownerControls(plan), listings: rows.map(ownerView), categories: await s.categories(),
      notice: notice ? { effectiveAt: notice.effective_at } : null,
      // Published apps that are not in the Community, with the choice to add them (paid plans).
      unlisted: published.filter(item => !listed.has(item.projectId)).map(item => item.projectId),
      freeNotice: FREE_PUBLISH_NOTICE,
    };
  }

  async function publishInfo(userId: string, projectId: string, organizationId: string) {
    const current = await switches();
    if (!communityVisible(current)) return { enabled: false };
    const s = store();
    const plan = await ctx.getOrganizationPlan(organizationId);
    const listing = await s.byProject(projectId);
    const kind = planKind(plan);
    return {
      enabled: true, plan, kind, notice: kind === 'free' ? FREE_PUBLISH_NOTICE : PAID_PUBLISH_NOTICE,
      listing: listing ? ownerView(listing) : null, offerState: listing?.offer_state || null,
      canOffer: kind !== 'free' && !(listing && (listing.opted_in || listing.offer_state === 'declined')),
    };
  }

  function validateText(input: { title?: unknown; description?: unknown; creatorAlias?: unknown }) {
    const out: { title?: string; description?: string; creator_alias?: string | null } = {};
    if (input.title !== undefined) {
      const title = cleanTitle(String(input.title));
      if (title.length < 3) throw new CommunityError(400, 'Le titre doit faire au moins 3 caractères.', 'INVALID_TITLE');
      out.title = title;
    }
    if (input.description !== undefined) out.description = String(input.description).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, 300);
    if (input.creatorAlias !== undefined) {
      const alias = String(input.creatorAlias || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
      out.creator_alias = alias && alias.toLowerCase() !== ANONYMOUS_CREATOR.toLowerCase() ? alias : null;
    }
    const text = `${out.title || ''}\n${out.description || ''}\n${out.creator_alias || ''}`;
    const personal = findPersonalData(text);
    if (personal.emails.length || personal.phones.length) throw new CommunityError(422, 'Retirez l’adresse e-mail ou le numéro de téléphone : ils seraient visibles de tous.', 'PERSONAL_DATA');
    if (moderateText(text).verdict !== 'clear') throw new CommunityError(422, 'Ce texte ne respecte pas les règles de la Communauté.', 'TEXT_REFUSED');
    return out;
  }

  /** The owner edits what visitors read about their app. Text is checked on the spot, so nothing unchecked ever goes public. */
  async function updateListing(userId: string, projectId: string, organizationId: string, patch: { title?: unknown; description?: unknown; category?: unknown; creatorAlias?: unknown; optedIn?: unknown; remixable?: unknown }, req?: any) {
    await ensureVisible();
    const s = store();
    const project = await ctx.loadProjectOwned(projectId, userId, req);
    if (!project) throw new CommunityError(404, 'Projet introuvable.', 'NOT_FOUND');
    const plan = await ctx.getOrganizationPlan(organizationId);
    const controls = ownerControls(plan);
    let listing = await s.byProject(projectId);
    if (listing && listing.owner_id !== userId) throw new CommunityError(404, 'Projet introuvable.', 'NOT_FOUND');
    const text = validateText(patch);
    const next: Partial<ListingRow> = { ...text };
    if (patch.category !== undefined) {
      const known = (await s.categories()).map(item => item.slug);
      if (!isKnownCategory(String(patch.category), known)) throw new CommunityError(400, 'Catégorie inconnue.', 'INVALID_CATEGORY');
      next.category = String(patch.category);
    }
    if (patch.remixable !== undefined) {
      if (!controls.canChoose) throw new CommunityError(403, 'Sur le plan gratuit, les apps de la Communauté sont remixables. Passez à un plan payant pour choisir.', 'FREE_PLAN_RULE');
      next.remixable = Boolean(patch.remixable);
    }
    const wantsOpt = patch.optedIn === undefined ? null : Boolean(patch.optedIn);
    if (wantsOpt !== null && !controls.canChoose) throw new CommunityError(403, 'Sur le plan gratuit, les apps publiées apparaissent automatiquement dans la Communauté. Passez à un plan payant pour choisir.', 'FREE_PLAN_RULE');

    if (!listing) {
      // The first time a paid-plan owner adds an app: the listing is created from the published version.
      if (wantsOpt !== true) throw new CommunityError(404, 'Cette app n’est pas dans la Communauté.', 'NOT_LISTED');
      const snapshot = await ctx.loadPublishedSnapshot(projectId);
      if (!snapshot) throw new CommunityError(409, 'Publiez d’abord votre app : seules les apps publiées peuvent apparaître dans la Communauté.', 'NOT_PUBLISHED');
      const category = next.category || classifyCategory({ title: String(next.title || project.name), description: project.prompt || '' }, (await s.categories()).map(item => item.slug)).slug;
      listing = await s.create({ project_id: projectId, owner_id: userId, organization_id: organizationId, title: next.title || cleanTitle(project.name), description: next.description || '', category, creator_alias: next.creator_alias ?? null, origin: 'paid_opt_in', opted_in: true, remixable: next.remixable ?? true, status: 'pending', public_url: snapshot.publicUrl });
      await s.journal({ listing_id: listing.id, project_id: projectId, actor_type: 'user', actor_id: userId, event: 'opted_in', to_status: 'pending', code: 'listable_paid_opt_in', reason: 'Le propriétaire a ajouté l’app à la Communauté.' });
      const versionId = await s.createVersion({ listing_id: listing.id, deployment_id: snapshot.deploymentId, artifact_hash: snapshot.artifactHash, public_url: snapshot.publicUrl, files: snapshot.files });
      enqueue(listing.id, versionId);
      return ownerView(listing);
    }

    if (wantsOpt === false && listing.opted_in) {
      listing = await s.transition(listing, 'removed_by_user', { actor: 'user', actorId: userId, event: 'opted_out', code: 'removed_by_user', reason: 'Le propriétaire a retiré l’app de la Communauté.', patch: { ...next, opted_in: false, indexable: false, featured: false } as Partial<ListingRow> });
      return ownerView(listing);
    }
    if (wantsOpt === true && !listing.opted_in) {
      if (listing.status === 'removed_by_moderation') throw new CommunityError(403, 'Cette app a été retirée par la modération. Vous pouvez contester la décision.', 'REMOVED_BY_MODERATION');
      const snapshot = await ctx.loadPublishedSnapshot(projectId);
      if (!snapshot) throw new CommunityError(409, 'Publiez d’abord votre app : seules les apps publiées peuvent apparaître dans la Communauté.', 'NOT_PUBLISHED');
      listing = await s.transition(listing, 'pending', { actor: 'user', actorId: userId, event: 'opted_in', code: 'listable_paid_opt_in', reason: 'Le propriétaire a ajouté l’app à la Communauté.', patch: { ...next, opted_in: true, origin: 'paid_opt_in', public_url: snapshot.publicUrl } as Partial<ListingRow> });
      const versionId = await s.createVersion({ listing_id: listing.id, deployment_id: snapshot.deploymentId, artifact_hash: snapshot.artifactHash, public_url: snapshot.publicUrl, files: snapshot.files });
      enqueue(listing.id, versionId);
      return ownerView(listing);
    }
    if (Object.keys(next).length) {
      listing = await s.update(listing.id, next);
      await s.journal({ listing_id: listing.id, project_id: projectId, actor_type: 'user', actor_id: userId, event: 'edited', code: 'edited', reason: 'Le propriétaire a modifié la fiche.', data: { fields: Object.keys(next) } });
    }
    return ownerView(listing);
  }

  /** « Ajouter à la communauté ? » after a successful publication: asked once, the answer remembered. */
  async function answerOffer(userId: string, projectId: string, organizationId: string, answer: 'accept' | 'later' | 'declined', req?: any) {
    await ensureVisible();
    const s = store();
    if (planKind(await ctx.getOrganizationPlan(organizationId)) === 'free') throw new CommunityError(400, 'Sur le plan gratuit, il n’y a pas de choix à faire.', 'FREE_PLAN_RULE');
    if (answer === 'accept') return updateListing(userId, projectId, organizationId, { optedIn: true }, req).then(async view => { await s.update(view.id, { offer_state: 'accepted' } as Partial<ListingRow>); return view; });
    const listing = await s.byProject(projectId);
    if (listing) await s.update(listing.id, { offer_state: answer === 'later' ? 'later' : 'declined' } as Partial<ListingRow>);
    else {
      // No listing yet: remember the answer on a dormant row would show an app that is not listed, so it is kept in the journal only.
      await s.journal({ project_id: projectId, actor_type: 'user', actor_id: userId, event: `offer_${answer}`, code: 'offer', reason: answer === 'later' ? 'Plus tard.' : 'Non merci.' });
    }
    return { ok: true };
  }

  async function offerAlreadyAnswered(projectId: string): Promise<boolean> {
    const s = store();
    const listing = await s.byProject(projectId);
    if (listing?.offer_state === 'declined' || listing?.offer_state === 'accepted') return true;
    const { data } = await ctx.getSupabase().from('community_moderation_events').select('event').eq('project_id', projectId).in('event', ['offer_declined']).limit(1);
    return Boolean(data?.length);
  }

  async function refreshThumbnail(userId: string, projectId: string, req?: any) {
    await ensureVisible();
    const s = store();
    const project = await ctx.loadProjectOwned(projectId, userId, req);
    const listing = await s.byProject(projectId);
    if (!project || !listing || listing.owner_id !== userId || listing.status !== 'online') throw new CommunityError(404, 'Cette app n’est pas en ligne dans la Communauté.', 'NOT_LISTED');
    const snapshot = await ctx.loadPublishedSnapshot(projectId);
    if (!snapshot) throw new CommunityError(409, 'Cette app n’est plus publiée.', 'NOT_PUBLISHED');
    const versionId = await s.createVersion({ listing_id: listing.id, deployment_id: snapshot.deploymentId, artifact_hash: snapshot.artifactHash, public_url: snapshot.publicUrl, files: snapshot.files });
    enqueue(listing.id, versionId);
    return { ok: true };
  }

  async function appeal(userId: string, listingId: string, message: string) {
    await ensureVisible();
    const s = store();
    const listing = await s.byId(listingId);
    if (!listing || listing.owner_id !== userId) throw new CommunityError(404, 'Annonce introuvable.', 'NOT_FOUND');
    if (!['refused', 'needs_fix', 'removed_by_moderation'].includes(listing.status)) throw new CommunityError(409, 'Il n’y a rien à contester pour cette app.', 'NOTHING_TO_APPEAL');
    const text = String(message || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 1000);
    if (text.length < 10) throw new CommunityError(400, 'Expliquez en quelques mots pourquoi cette décision vous semble erronée.', 'INVALID_MESSAGE');
    const created = await s.addAppeal({ listing_id: listing.id, user_id: userId, message: text });
    if (!created) throw new CommunityError(409, 'Une contestation est déjà en cours pour cette app.', 'APPEAL_OPEN');
    await s.journal({ listing_id: listing.id, project_id: listing.project_id, actor_type: 'user', actor_id: userId, event: 'appeal', code: 'appeal', reason: text.slice(0, 200) });
    return { ok: true };
  }

  // ── Visitors ────────────────────────────────────────────────────────────────────────────────────────────────────
  async function list(input: { tab: ListTab; category?: string; q?: string; cursor?: string | null; limit?: number; viewer?: string | null }) {
    await ensureVisible();
    return store().list(input);
  }

  async function detail(id: string, viewer?: string | null) {
    await ensureVisible();
    const s = store();
    const item = await s.publicDetail(id, viewer);
    if (!item) throw new CommunityError(404, 'Cette app n’est plus disponible dans la Communauté.', 'NOT_FOUND');
    return { listing: item, similar: await s.similar({ id: item.id, category: item.category }), categories: await s.categories() };
  }

  function viewerKey(userId: string | null, ip: string, agent: string) {
    return sha(`${env.CODEN_COMMUNITY_SALT || 'coden-community'}|${userId || `${ip}|${agent.slice(0, 80)}`}`).slice(0, 40);
  }

  async function recordView(listingId: string, input: { userId: string | null; ip: string; agent: string }) {
    await ensureVisible();
    const s = store();
    const row = await s.byId(listingId);
    if (!row || row.status !== 'online') return { counted: false };
    // The owner looking at their own app never raises its numbers.
    if (input.userId && input.userId === row.owner_id) return { counted: false };
    return { counted: await s.recordView(listingId, viewerKey(input.userId, input.ip, input.agent)) };
  }

  async function like(userId: string, listingId: string) {
    await ensureVisible();
    const s = store();
    const row = await s.byId(listingId);
    if (!row || row.status !== 'online') throw new CommunityError(404, 'Cette app n’est plus disponible dans la Communauté.', 'NOT_FOUND');
    if (row.owner_id === userId) throw new CommunityError(403, 'Vous ne pouvez pas aimer votre propre app.', 'OWN_LISTING');
    return s.toggleLike(listingId, userId);
  }

  async function report(userId: string, listingId: string, reason: unknown, details: unknown) {
    await ensureVisible();
    const s = store();
    if (!isReportReason(reason)) throw new CommunityError(400, 'Choisissez un motif de signalement.', 'INVALID_REASON');
    const row = await s.byId(listingId);
    if (!row || (row.status !== 'online' && row.status !== 'hidden')) throw new CommunityError(404, 'Cette app n’est plus disponible dans la Communauté.', 'NOT_FOUND');
    if (row.owner_id === userId) throw new CommunityError(403, 'Vous ne pouvez pas signaler votre propre app.', 'OWN_LISTING');
    const { created } = await s.addReport({ listing_id: listingId, reporter_id: userId, reason, details: String(details || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim() });
    if (!created) return { ok: true, duplicate: true };
    const open = await s.openReports(listingId);
    await ctx.getSupabase().from('community_listings').update({ report_count: open.length }).eq('id', listingId);
    await s.journal({ listing_id: listingId, project_id: row.project_id, actor_type: 'user', actor_id: userId, event: 'reported', code: reason, reason: 'Signalement reçu.' });
    const decision = reportsAction(open, limits);
    if (decision.hide && row.status === 'online') {
      const hidden = await s.transition(row, 'hidden', { actor: 'system', event: 'auto_hidden', code: 'reports_threshold', reason: `Masquée le temps d’un examen : ${decision.distinct} signalements de personnes différentes.`, data: { reporters: decision.distinct } });
      // A reinforced re-analysis on a fresh copy of what is published; the pipeline decides whether it comes back.
      const snapshot = await ctx.loadPublishedSnapshot(row.project_id).catch(() => null);
      if (snapshot) {
        const versionId = await s.createVersion({ listing_id: hidden.id, deployment_id: snapshot.deploymentId, artifact_hash: snapshot.artifactHash, public_url: snapshot.publicUrl, files: snapshot.files });
        enqueue(hidden.id, versionId, { strict: true });
      }
    }
    return { ok: true };
  }

  async function thumbnail(listingId: string): Promise<{ buffer: Buffer; etag: string } | null> {
    const s = store();
    const row = await s.byId(listingId);
    if (!row || row.status !== 'online' || !row.thumbnail_path) return null;
    const { data, error } = await ctx.getSupabase().storage.from('community-thumbs').download(row.thumbnail_path);
    if (error || !data) return null;
    return { buffer: Buffer.from(await data.arrayBuffer()), etag: `"${sha(row.thumbnail_path).slice(0, 20)}"` };
  }

  // ── Remix ───────────────────────────────────────────────────────────────────────────────────────────────────────
  async function remix(userId: string, listingId: string, req?: any): Promise<{ project: { id: string; name: string }; builderUrl: string; reconnect: Reconnect[]; attribution: string }> {
    await ensureVisible();
    const s = store();
    const listing = await s.byId(listingId);
    if (!listing || listing.status !== 'online') throw new CommunityError(404, 'Cette app n’est plus disponible dans la Communauté.', 'NOT_FOUND');
    if (!listing.remixable) throw new CommunityError(403, 'Le créateur propose cette app en aperçu seulement.', 'PREVIEW_ONLY');
    const allowed = remixAllowed(await s.remixHistory(userId, listing.owner_id), limits);
    if (!allowed.ok) throw new CommunityError(429, allowed.reason, `REMIX_${allowed.code.toUpperCase()}`);
    // From the frozen published version, never from the creator's draft.
    const version = listing.current_version_id ? await s.getVersion(listing.current_version_id) : null;
    if (!version?.files?.length) throw new CommunityError(409, 'Cette app ne peut pas être remixée pour le moment.', 'NO_SNAPSHOT');
    const kept = selectRemixFiles(version.files).files.map(file => neutralizeConnections(file).file);
    if (!kept.length) throw new CommunityError(409, 'Cette app ne peut pas être remixée pour le moment.', 'NO_SNAPSHOT');
    const creator = listing.creator_alias || ANONYMOUS_CREATOR;
    const attribution = { listingId: listing.id, title: listing.title, creator };
    const created = await ctx.createProjectFromFiles({
      userId, req, name: `${listing.title} (remix)`.slice(0, 120), prompt: attributionNote(attribution), files: kept, reason: 'remix', meta: remixMetadata(attribution),
    });
    await s.recordRemix({ listing_id: listing.id, source_project_id: null, new_project_id: created.id, user_id: userId });
    await s.journal({ listing_id: listing.id, project_id: listing.project_id, actor_type: 'user', actor_id: userId, event: 'remixed', code: 'remixed', reason: 'Un utilisateur a remixé cette app.', data: { files: kept.length } });
    return { project: created, builderUrl: `/builder.html?project=${created.id}`, reconnect: reconnectList(kept), attribution: attributionNote(attribution) };
  }

  async function remixOrigin(projectId: string, userId: string) {
    const client = ctx.getSupabase();
    if (!client) return null;
    const { data } = await client.from('community_remixes').select('listing_id,template_id').eq('new_project_id', projectId).eq('user_id', userId).maybeSingle();
    if (!data) return null;
    if (data.template_id) {
      const template = OFFICIAL_TEMPLATES.find(item => item.slug === data.template_id);
      return template ? { kind: 'template' as const, title: template.title, listingId: null as string | null, creator: 'Coden' } : null;
    }
    const listing = data.listing_id ? await store().byId(data.listing_id) : null;
    // Linked only while the original is still public; a removed app leaves its name but no link.
    return { kind: 'listing' as const, title: listing?.title || 'une app de la Communauté', listingId: listing && listing.status === 'online' ? listing.id : null, creator: listing?.creator_alias || ANONYMOUS_CREATOR };
  }

  // ── Official templates ──────────────────────────────────────────────────────────────────────────────────────────
  async function templates(plan: string) {
    await ensureVisible();
    const s = store();
    await s.seedTemplates(OFFICIAL_TEMPLATES.map((template, index) => ({ slug: template.slug, title: template.title, description: template.description, category: template.category, brief: template.brief, position: index, design_score: template.designScore })));
    const rows = await s.templates();
    const order = ['free', 'pro', 'business', 'enterprise'];
    return rows.map(row => ({ ...row, official: true, available: order.indexOf(plan) >= order.indexOf(row.min_plan) || order.indexOf(row.min_plan) < 0 }));
  }

  async function useTemplate(userId: string, slug: string, plan: string, req?: any) {
    await ensureVisible();
    const s = store();
    const template = await s.template(slug);
    if (!template || !template.active) throw new CommunityError(404, 'Ce template n’existe pas.', 'NOT_FOUND');
    const order = ['free', 'pro', 'business', 'enterprise'];
    if (order.indexOf(plan) < order.indexOf(template.min_plan)) throw new CommunityError(403, 'Ce template est réservé à un plan supérieur.', 'PLAN_REQUIRED');
    await s.bumpTemplateUse(slug);
    // The project is created by the dashboard's normal flow, with the template's brief as the first request to the agent.
    return { prompt: template.brief, title: template.title, templateId: template.slug, version: template.version };
  }

  async function recordTemplateProject(userId: string, slug: string, projectId: string) {
    await store().recordRemix({ template_id: slug, new_project_id: projectId, user_id: userId });
  }

  // ── Ranking & periodic work ─────────────────────────────────────────────────────────────────────────────────────
  async function refreshRankings(): Promise<number> {
    const s = store();
    const rows = await s.onlineForRanking();
    if (!rows.length) return 0;
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const engagement = await s.engagementSince(rows.map(row => row.id), since, new Map(rows.map(row => [row.id, row.owner_id])));
    for (const row of rows) {
      const stats = engagement.get(row.id) || { views: 0, likes: 0, remixes: 0 };
      await s.setTrending(row.id, trendingScore({ views7d: stats.views, likes7d: stats.likes, remixes7d: stats.remixes, quality: row.quality_score, listedAt: row.listed_at || new Date() }));
    }
    return rows.length;
  }

  /** Listings waiting out a probation or stranded by a restart are picked up again. */
  async function sweepPending(): Promise<number> {
    const s = store();
    const client = ctx.getSupabase();
    const { data } = await client.from('community_listings').select('id').eq('status', 'pending').or(`hold_until.is.null,hold_until.lte.${new Date().toISOString()}`).limit(25);
    let count = 0;
    for (const row of data || []) {
      const { data: versions } = await client.from('community_listing_versions').select('id').eq('listing_id', row.id).eq('state', 'checking').order('created_at', { ascending: false }).limit(1);
      if (versions?.[0] && queued < 20) { enqueue(row.id, versions[0].id); count += 1; }
    }
    return count;
  }

  let timers: Array<ReturnType<typeof setInterval>> = [];
  function startWorkers() {
    if (!envSwitches.enabled || timers.length) return;
    const safe = (name: string, job: () => Promise<unknown>) => () => { void job().catch(error => log(`${name}_failed`, { message: String(error?.message || error).slice(0, 160) })); };
    timers = [
      setInterval(safe('sweep', sweepPending), 5 * 60_000),
      setInterval(safe('rankings', refreshRankings), 10 * 60_000),
      setInterval(safe('notices', applyDueNotices), 60 * 60_000),
    ];
    for (const timer of timers) timer.unref?.();
    // Soon after boot: finish what a restart interrupted.
    const first = setTimeout(safe('sweep', sweepPending), 60_000);
    first.unref?.();
  }

  return {
    switches, ensureVisible, store, onPublished, onUnpublished, onPlanChanged, purgeUser, mine, publishInfo, updateListing, answerOffer, offerAlreadyAnswered, refreshThumbnail, appeal,
    list, detail, recordView, like, report, thumbnail, remix, remixOrigin, templates, useTemplate, recordTemplateProject, refreshRankings, sweepPending, applyDueNotices, startWorkers,
    applySanction, enqueue, queueSize: () => queued, limits,
  };
}

export type CommunityService = ReturnType<typeof createCommunityService>;
