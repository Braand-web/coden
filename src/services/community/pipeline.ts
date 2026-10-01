/**
 * The checks a listing goes through before visitors can see it, and what happens to the listing afterwards.
 *
 * It runs in the background, after the publication — never inside it: a slow or failing check can delay a listing, it can
 * never block or undo someone's publication. Everything it needs from outside (a browser, a vision model, storage, the
 * mailbox) is passed in, so the whole flow is tested without any of them.
 */
import {
  contentFingerprint, decideVerdict, detectImpersonation, duplicateCheck, moderateText, privacyCheck, qualityCheck, republicationOutcome,
  securityCheck, technicalCheck, type CheckResult, type PageSignals, type SourceFile, type Verdict,
} from './checks.ts';
import { abuseCheck, readLimits, type CommunityLimits } from './rules.ts';
import type { Inspection } from './inspector.ts';
import type { CommunityStore, ListingRow } from './store.ts';
import { decideListing, type VisibilityDecision } from './visibility.ts';

export type VisionVerdict = 'clear' | 'doubt' | 'block';

export type PipelineDeps = {
  store: CommunityStore;
  inspect: (url: string) => Promise<Inspection>;
  /** Looks at the screenshot, only when the text left a doubt. Absent when no vision model is available. */
  moderateImage?: (image: Buffer, context: { title: string; categories: string[] }) => Promise<VisionVerdict>;
  saveThumbnail: (listingId: string, versionId: string, image: Buffer) => Promise<string | null>;
  notifyOwner: (listing: ListingRow, verdict: Verdict) => Promise<void>;
  /** The listing decision as it stands *now* (plan, protection, owner's choice): never what it was at publication. */
  currentVisibility: (listing: ListingRow) => Promise<VisibilityDecision>;
  accountCreatedAt: (ownerId: string) => Promise<string | null>;
  limits?: CommunityLimits;
  now?: () => Date;
  /** A reinforced re-analysis (after reports): a doubt no model could settle counts against the app instead of for it. */
  strict?: boolean;
  /** The listing had been hidden by reports and the re-analysis refused it: the reports are upheld. */
  onUpheld?: (listing: ListingRow) => Promise<void>;
  /** The listing had been hidden by reports and the re-analysis found nothing: the reports are dismissed. */
  onCleared?: (listing: ListingRow) => Promise<void>;
};

export type PipelineOutcome =
  | { kind: 'skipped'; reason: string }
  | { kind: 'held'; until: string }
  | { kind: 'done'; verdict: Verdict; action: 'replace' | 'keep_previous' | 'remove' };

const DISCOVER_QUALITY_UNIT = 1e11;
const DISCOVER_FEATURED_UNIT = 1e14;

/** One sortable key per listing: featured on top, then quality, then recency. Lets « Découvrir » page by a single cursor. */
export function discoverRank(input: { quality: number | null; featured: boolean; listedAt: string | Date }): number {
  const seconds = Math.floor(new Date(input.listedAt).getTime() / 1000);
  return (input.featured ? DISCOVER_FEATURED_UNIT : 0) + Math.round(Math.max(0, Math.min(100, input.quality ?? 0))) * DISCOVER_QUALITY_UNIT + (Number.isFinite(seconds) ? seconds : 0);
}

/** « Choix de Coden »: only the best, and only apps the checks found nothing to say about. */
export const CHOICE_MIN_SCORE = 85;

export async function runListingChecks(deps: PipelineDeps, listingId: string, versionId: string): Promise<PipelineOutcome> {
  const { store } = deps;
  const now = deps.now?.() || new Date();
  const limits = deps.limits || readLimits();
  const listing = await store.byId(listingId);
  if (!listing) return { kind: 'skipped', reason: 'listing_gone' };
  if (listing.status === 'removed_by_user' || listing.status === 'removed_by_moderation') return { kind: 'skipped', reason: listing.status };
  const version = await store.getVersion(versionId);
  if (!version || version.listing_id !== listing.id) return { kind: 'skipped', reason: 'version_gone' };

  // The rule is asked again here: a plan change or an unpublish between the publication and now must win.
  const visibility = await deps.currentVisibility(listing);
  if (!visibility.listable) {
    if (listing.status === 'online' || listing.status === 'pending') {
      await store.transition(listing, 'removed_by_user', { actor: 'system', event: 'visibility_changed', code: visibility.code, reason: visibility.reason });
    }
    await store.finishVersion(versionId, { state: 'failed', severity: null, report: { skipped: visibility.code } });
    return { kind: 'skipped', reason: visibility.code };
  }

  // Anti-abuse comes first: it is the cheapest check and may hold the listing without opening a browser.
  const sanction = await store.activeSanction(listing.owner_id);
  const created = await deps.accountCreatedAt(listing.owner_id);
  const onlineCount = await store.onlineCountForOwner(listing.owner_id);
  const abuse = abuseCheck({ accountCreatedAt: created, onlineCount: listing.status === 'online' ? Math.max(0, onlineCount - 1) : onlineCount, sanction, now, limits });
  if (abuse.outcome === 'pass' && abuse.holdUntil) {
    await store.update(listing.id, { hold_until: abuse.holdUntil, status_code: abuse.code, status_reason: abuse.reason } as Partial<ListingRow>);
    await store.journal({ listing_id: listing.id, project_id: listing.project_id, actor_type: 'system', event: 'held', code: abuse.code, reason: abuse.reason, data: { until: abuse.holdUntil } });
    return { kind: 'held', until: abuse.holdUntil };
  }

  const inspection = await deps.inspect(version.public_url || listing.public_url || '').catch((): Inspection => ({
    signals: { reachable: false, textLength: 0, pageErrors: [] }, delivered: [], thumbnail: null, blurred: 0,
  }));
  const signals: PageSignals = inspection.signals;
  const source: SourceFile[] = version.files || [];

  const results: CheckResult[] = [abuse, technicalCheck(signals)];
  // What the browser actually receives is scanned as well as the source: a key can be bundled in from an environment variable.
  results.push(securityCheck([...source, ...inspection.delivered]));
  results.push(...moderationResults({ title: listing.title, description: listing.description, signals }));

  // The cheap text pass may leave a doubt; only then does a model look at the screenshot.
  const doubtful = results.filter(result => result.key === 'moderation' && result.outcome === 'warn' && result.data?.needsVision === true);
  if (doubtful.length) {
    const categories = [...new Set(doubtful.flatMap(result => (result.data?.categories as string[]) || []))];
    let vision: VisionVerdict | null = null;
    if (deps.moderateImage && inspection.thumbnail) vision = await deps.moderateImage(inspection.thumbnail, { title: listing.title, categories }).catch(() => null);
    for (const result of doubtful) {
      results.splice(results.indexOf(result), 1);
      if (vision === 'block') results.push({ key: 'moderation', outcome: 'block', code: 'moderation_vision_block', reason: 'Le contenu de l’app ne respecte pas les règles de la Communauté.', remedy: 'Vous pouvez contester cette décision depuis « Mes publications ».', data: { categories } });
      else if (vision === 'clear') results.push({ key: 'moderation', outcome: 'pass', code: 'moderation_vision_clear', reason: 'Le contenu a été examiné et ne pose pas de problème.' });
      // No vision verdict (no model, error): listed but kept out of every featured place, and journaled as unreviewed.
      else results.push({ key: 'moderation', outcome: 'warn', code: 'moderation_unreviewed', reason: 'Un doute subsiste sur le contenu : l’app est visible mais jamais mise en avant.', data: { categories, featurable: false } });
    }
  }

  if (deps.strict) {
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.key === 'moderation' && result.outcome === 'warn') results[index] = { ...result, outcome: 'fail', code: 'moderation_review', reason: 'Après des signalements, un doute sur le contenu n’a pas pu être levé.', remedy: 'Vous pouvez contester cette décision depuis « Mes publications ».' };
    }
  }
  results.push(privacyCheck({ title: listing.title, description: listing.description }));
  const fingerprint = contentFingerprint(source, signals.visibleText || '');
  results.push(duplicateCheck(fingerprint, await store.fingerprints(listing.project_id)));
  results.push(qualityCheck(signals, source));

  const verdict = decideVerdict(results);
  const hasValidated = Boolean(listing.current_version_id) && listing.status === 'online';
  const action = republicationOutcome(verdict, hasValidated);
  const report = { results: results.map(({ key, outcome, code, reason }) => ({ key, outcome, code, reason })), blurred: inspection.blurred };

  if (action === 'replace') {
    const thumbnailPath = inspection.thumbnail ? await deps.saveThumbnail(listing.id, versionId, inspection.thumbnail).catch(() => null) : null;
    const quality = verdict.qualityScore;
    const choice = verdict.featurable && (quality ?? 0) >= CHOICE_MIN_SCORE;
    const listedAt = listing.listed_at || now.toISOString();
    await store.finishVersion(versionId, { state: 'passed', severity: null, report, thumbnail_path: thumbnailPath, quality_score: quality });
    await store.transition(listing, 'online', {
      actor: 'system', event: listing.status === 'online' ? 'republished' : listing.status === 'hidden' ? 'reanalysis_cleared' : 'listed', code: verdict.code, reason: verdict.reason, data: { quality, origin: visibility.origin },
      patch: {
        current_version_id: versionId, public_url: version.public_url || listing.public_url, thumbnail_path: thumbnailPath || listing.thumbnail_path,
        thumbnail_alt: `Aperçu de « ${listing.title.slice(0, 80)} »`, quality_score: quality, featured: choice, indexable: true, content_fingerprint: fingerprint || null,
        origin: visibility.origin || listing.origin, hold_until: null, checked_at: now.toISOString(), listed_at: listedAt,
        discover_rank: discoverRank({ quality, featured: choice, listedAt }),
      } as Partial<ListingRow>,
    });
    await store.pruneVersionFiles(listing.id, [versionId]);
    if (listing.status === 'hidden') await deps.onCleared?.(listing).catch(() => undefined);
  } else if (action === 'keep_previous') {
    // The new version failed; visitors keep the last one that passed. The owner is told what to fix.
    await store.finishVersion(versionId, { state: 'failed', severity: verdict.severity, report });
    await store.update(listing.id, { status_code: verdict.code, status_reason: verdict.reason, checked_at: now.toISOString() } as Partial<ListingRow>);
    await store.journal({ listing_id: listing.id, project_id: listing.project_id, actor_type: 'system', event: 'republication_failed', from_status: 'online', to_status: 'online', code: verdict.code, reason: verdict.reason, data: { kept_version: listing.current_version_id } });
    await store.pruneVersionFiles(listing.id, [listing.current_version_id || '']);
  } else {
    await store.finishVersion(versionId, { state: 'failed', severity: verdict.severity, report });
    await store.transition(listing, verdict.state === 'refused' ? 'refused' : 'needs_fix', {
      actor: 'system', event: 'listing_blocked', code: verdict.code, reason: verdict.reason, data: { severity: verdict.severity, remedy: verdict.remedy },
      patch: { checked_at: now.toISOString(), hold_until: null, featured: false, indexable: false } as Partial<ListingRow>,
    });
    await store.pruneVersionFiles(listing.id, []);
    if (listing.status === 'hidden' && verdict.state === 'refused') await deps.onUpheld?.(listing).catch(() => undefined);
  }

  if (verdict.state !== 'online') await deps.notifyOwner(listing, verdict).catch(() => undefined);
  return { kind: 'done', verdict, action };
}

function moderationResults(input: { title: string; description: string; signals: PageSignals }): CheckResult[] {
  const text = `${input.title}\n${input.description}\n${input.signals.title || ''}\n${input.signals.visibleText || ''}`;
  const out: CheckResult[] = [];
  const words = moderateText(text);
  if (words.verdict === 'block') {
    out.push({ key: 'moderation', outcome: 'block', code: `moderation_${words.categories[0] || 'rules'}`, reason: 'Le contenu de l’app ne respecte pas les règles de la Communauté.', remedy: 'Vous pouvez contester cette décision depuis « Mes publications ».', data: { categories: words.categories } });
  } else if (words.verdict === 'doubt') {
    out.push({ key: 'moderation', outcome: 'warn', code: 'moderation_doubt', reason: 'Un doute subsiste sur le contenu.', data: { categories: words.categories, needsVision: true, featurable: false } });
  }
  const brand = detectImpersonation({ title: input.title || input.signals.title, description: input.description, visibleText: input.signals.visibleText, hasPasswordField: input.signals.hasPasswordField });
  if (brand.verdict === 'block') {
    out.push({ key: 'moderation', outcome: 'block', code: 'impersonation', reason: `Cette app imite la page de connexion d’une marque connue (${brand.brand}).`, remedy: 'Vous pouvez contester cette décision depuis « Mes publications ».', data: { categories: ['impersonation'], brand: brand.brand } });
  } else if (brand.verdict === 'doubt') {
    out.push({ key: 'moderation', outcome: 'warn', code: 'impersonation_doubt', reason: 'Un doute subsiste : l’app cite une marque connue sur une page de connexion.', data: { categories: ['impersonation'], needsVision: true, featurable: false } });
  }
  if (!out.length) out.push({ key: 'moderation', outcome: 'pass', code: 'moderation_ok', reason: 'Aucun problème de contenu détecté.' });
  return out;
}

/** The visibility decision for a listing, from what is true today. Shared by the pipeline and the owner's screens. */
export function visibilityForListing(listing: Pick<ListingRow, 'status' | 'opted_in'>, facts: { published: boolean; protection?: 'none' | 'password' | 'private'; plan: string | null; frozen: boolean; autoListNotBefore?: string | null }): VisibilityDecision {
  return decideListing({
    published: facts.published, protection: facts.protection, plan: facts.plan, optedIn: listing.opted_in,
    removedByModeration: listing.status === 'removed_by_moderation', listingsFrozen: facts.frozen, alreadyListed: listing.status === 'online', autoListNotBefore: facts.autoListNotBefore,
  });
}
