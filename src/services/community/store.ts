/**
 * Everything the Community reads and writes in the database. One class, one place: the routes and the checking
 * pipeline never touch a table directly, so the access rules (who may read what) are kept here.
 *
 * Public reads only ever return listings that are « en ligne », and only the fields a visitor may see — never the owner's
 * id, e-mail or real name, never the source. The service-role client is used, so the filtering is done in this file, in
 * one place, and covered by tests.
 */
import { DEFAULT_CATEGORIES, type CommunityCategory } from './categories.ts';
import type { CheckResult, ListingState, Severity } from './checks.ts';
import type { ListingOrigin } from './visibility.ts';

export type ListingStatus = 'pending' | 'online' | 'needs_fix' | 'refused' | 'removed_by_user' | 'removed_by_moderation' | 'hidden';

export const STATUS_LABELS: Record<ListingStatus, string> = {
  pending: 'En contrôle',
  online: 'En ligne',
  needs_fix: 'À corriger',
  refused: 'Refusé',
  removed_by_user: 'Retiré par vous',
  removed_by_moderation: 'Retiré par la modération',
  hidden: 'Masqué le temps d’un examen',
};

export type ListingRow = {
  id: string;
  project_id: string;
  owner_id: string;
  organization_id: string | null;
  title: string;
  description: string;
  category: string;
  tags: string[];
  creator_alias: string | null;
  origin: ListingOrigin;
  opted_in: boolean;
  remixable: boolean;
  status: ListingStatus;
  status_code: string | null;
  status_reason: string | null;
  current_version_id: string | null;
  public_url: string | null;
  thumbnail_path: string | null;
  thumbnail_alt: string | null;
  quality_score: number | null;
  featured: boolean;
  indexable: boolean;
  view_count: number;
  like_count: number;
  remix_count: number;
  report_count: number;
  trending_score: number;
  discover_rank: number;
  content_fingerprint: string | null;
  offer_state: 'later' | 'declined' | 'accepted' | null;
  listed_at: string | null;
  checked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JournalEntry = {
  listing_id?: string | null;
  project_id?: string | null;
  actor_type: 'system' | 'user' | 'admin';
  actor_id?: string | null;
  event: string;
  from_status?: string | null;
  to_status?: string | null;
  code?: string | null;
  reason?: string | null;
  data?: Record<string, unknown>;
};

export type ListTab = 'discover' | 'trending' | 'recent';

export const ANONYMOUS_CREATOR = 'Créateur anonyme';
const PAGE_MAX = 40;

const LISTING_COLUMNS = '*';
// What a visitor may see of a listing. Nothing else leaves this file on a public read.
const PUBLIC_COLUMNS = 'id,title,description,category,tags,creator_alias,owner_id,remixable,thumbnail_path,thumbnail_alt,quality_score,featured,like_count,remix_count,listed_at,discover_rank,trending_score,thumbnail_version:updated_at';

export type PublicListing = {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  creator: string;
  creatorProfile: string | null;
  remixable: boolean;
  thumbnail: string | null;
  thumbnailAlt: string;
  featured: boolean;
  likes: number;
  remixes: number;
  listedAt: string | null;
  liked?: boolean;
  mine?: boolean;
};

const sanitizeSearch = (value: string) => String(value || '').replace(/[,()%*\\:"'`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

type Client = any;

export class CommunityStore {
  constructor(private readonly client: Client) {}

  // ── Settings (kill switches) ────────────────────────────────────────────────────────────────────────────────────
  async settings(): Promise<{ hidden: boolean; frozen: boolean }> {
    const { data, error } = await this.client.from('community_settings').select('key,value').in('key', ['hidden', 'frozen']);
    if (error) throw new Error(`community_settings: ${error.message}`);
    const map = new Map<string, unknown>((data || []).map((row: any) => [row.key, row.value]));
    return { hidden: map.get('hidden') === true, frozen: map.get('frozen') === true };
  }

  async setSetting(key: 'hidden' | 'frozen', value: boolean, by: string): Promise<void> {
    const { error } = await this.client.from('community_settings').upsert({ key, value, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw new Error(`community_settings: ${error.message}`);
  }

  // ── Categories ──────────────────────────────────────────────────────────────────────────────────────────────────
  async categories(): Promise<CommunityCategory[]> {
    const { data, error } = await this.client.from('community_categories').select('slug,label').eq('active', true).order('position', { ascending: true });
    if (error || !data?.length) return [...DEFAULT_CATEGORIES];
    return data as CommunityCategory[];
  }

  // ── Journal ─────────────────────────────────────────────────────────────────────────────────────────────────────
  async journal(entry: JournalEntry): Promise<void> {
    const { error } = await this.client.from('community_moderation_events').insert({
      listing_id: entry.listing_id || null, project_id: entry.project_id || null, actor_type: entry.actor_type, actor_id: entry.actor_id || null,
      event: entry.event, from_status: entry.from_status || null, to_status: entry.to_status || null, code: entry.code || null,
      reason: entry.reason ? String(entry.reason).slice(0, 600) : null, data: entry.data || {},
    });
    // The journal must never take the action down with it, but a lost entry must not be silent either.
    if (error) console.warn('[coden:community_journal_failed]', { event: entry.event, message: error.message });
  }

  async journalFor(listingId: string, limit = 50) {
    const { data } = await this.client.from('community_moderation_events').select('id,actor_type,event,from_status,to_status,code,reason,created_at').eq('listing_id', listingId).order('created_at', { ascending: false }).limit(limit);
    return data || [];
  }

  // ── Listings ────────────────────────────────────────────────────────────────────────────────────────────────────
  async byProject(projectId: string): Promise<ListingRow | null> {
    const { data, error } = await this.client.from('community_listings').select(LISTING_COLUMNS).eq('project_id', projectId).maybeSingle();
    if (error) throw new Error(`community_listings: ${error.message}`);
    return (data as ListingRow) || null;
  }

  async byId(id: string): Promise<ListingRow | null> {
    const { data, error } = await this.client.from('community_listings').select(LISTING_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw new Error(`community_listings: ${error.message}`);
    return (data as ListingRow) || null;
  }

  async mine(ownerId: string): Promise<ListingRow[]> {
    const { data, error } = await this.client.from('community_listings').select(LISTING_COLUMNS).eq('owner_id', ownerId).order('updated_at', { ascending: false }).limit(200);
    if (error) throw new Error(`community_listings: ${error.message}`);
    return (data || []) as ListingRow[];
  }

  async create(row: Partial<ListingRow> & { project_id: string; owner_id: string; title: string }): Promise<ListingRow> {
    const { data, error } = await this.client.from('community_listings').insert(row).select(LISTING_COLUMNS).single();
    if (error) throw new Error(`community_listings: ${error.message}`);
    return data as ListingRow;
  }

  async update(id: string, patch: Partial<ListingRow>): Promise<ListingRow> {
    const { data, error } = await this.client.from('community_listings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select(LISTING_COLUMNS).single();
    if (error) throw new Error(`community_listings: ${error.message}`);
    return data as ListingRow;
  }

  /** Moves a listing to a new status and writes the decision to the journal in the same breath. */
  async transition(listing: ListingRow, to: ListingStatus, why: { actor: JournalEntry['actor_type']; actorId?: string | null; event: string; code: string; reason: string; patch?: Partial<ListingRow>; data?: Record<string, unknown> }): Promise<ListingRow> {
    const patch: Partial<ListingRow> = { ...why.patch, status: to, status_code: why.code, status_reason: why.reason.slice(0, 600) };
    if (to === 'online' && !listing.listed_at) patch.listed_at = new Date().toISOString();
    const next = await this.update(listing.id, patch);
    await this.journal({ listing_id: listing.id, project_id: listing.project_id, actor_type: why.actor, actor_id: why.actorId, event: why.event, from_status: listing.status, to_status: to, code: why.code, reason: why.reason, data: why.data });
    return next;
  }

  async onlineCountForOwner(ownerId: string): Promise<number> {
    const { count } = await this.client.from('community_listings').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId).eq('status', 'online');
    return count || 0;
  }

  async fingerprints(excludeProjectId: string, limit = 3000): Promise<Array<{ id: string; title: string; fingerprint: string }>> {
    const { data } = await this.client.from('community_listings').select('id,title,content_fingerprint').eq('status', 'online').not('content_fingerprint', 'is', null).neq('project_id', excludeProjectId).order('listed_at', { ascending: false }).limit(limit);
    return (data || []).map((row: any) => ({ id: row.id, title: row.title, fingerprint: row.content_fingerprint }));
  }

  // ── Versions ────────────────────────────────────────────────────────────────────────────────────────────────────
  async createVersion(input: { listing_id: string; deployment_id?: string | null; artifact_hash?: string | null; public_url?: string | null; files: Array<{ path: string; content: string }> }) {
    const files = input.files;
    const bytes = files.reduce((sum, file) => sum + file.content.length, 0);
    const { data, error } = await this.client.from('community_listing_versions').insert({ listing_id: input.listing_id, deployment_id: input.deployment_id || null, artifact_hash: input.artifact_hash || null, public_url: input.public_url || null, files, files_bytes: bytes }).select('id').single();
    if (error) throw new Error(`community_listing_versions: ${error.message}`);
    return data.id as string;
  }

  async finishVersion(id: string, input: { state: 'passed' | 'failed'; severity: Severity | null; report: Record<string, unknown>; thumbnail_path?: string | null; quality_score?: number | null }) {
    await this.client.from('community_listing_versions').update({ state: input.state, severity: input.severity, report: input.report, thumbnail_path: input.thumbnail_path || null, quality_score: input.quality_score ?? null, finished_at: new Date().toISOString() }).eq('id', id);
  }

  async getVersion(id: string) {
    const { data } = await this.client.from('community_listing_versions').select('id,listing_id,deployment_id,artifact_hash,public_url,state,files,thumbnail_path,quality_score,created_at').eq('id', id).maybeSingle();
    return data as null | { id: string; listing_id: string; deployment_id: string | null; artifact_hash: string | null; public_url: string | null; state: string; files: Array<{ path: string; content: string }> | null; thumbnail_path: string | null; quality_score: number | null; created_at: string };
  }

  /** Old versions keep their report but give up their files: only the current validated version and the one being judged need them. */
  async pruneVersionFiles(listingId: string, keepIds: string[]) {
    const ids = keepIds.filter(Boolean);
    let query = this.client.from('community_listing_versions').update({ files: null, files_bytes: 0 }).eq('listing_id', listingId).not('files', 'is', null);
    if (ids.length) query = query.not('id', 'in', `(${ids.join(',')})`);
    await query;
  }

  // ── Public reads ────────────────────────────────────────────────────────────────────────────────────────────────
  private async aliasFor(rows: Array<{ owner_id: string; creator_alias: string | null }>): Promise<Map<string, { name: string; profile: string | null }>> {
    const owners = [...new Set(rows.map(row => row.owner_id))];
    const profiles = new Map<string, string>();
    if (owners.length) {
      const { data } = await this.client.from('community_profiles').select('user_id,display_name,public').in('user_id', owners).eq('public', true);
      for (const row of data || []) if (row.display_name) profiles.set(row.user_id, row.display_name);
    }
    const result = new Map<string, { name: string; profile: string | null }>();
    for (const row of rows) {
      // The creator's own choice wins; then their public profile name; never an e-mail or an account name.
      const name = String(row.creator_alias || '').trim() || profiles.get(row.owner_id) || ANONYMOUS_CREATOR;
      result.set(row.owner_id, { name, profile: profiles.has(row.owner_id) ? row.owner_id : null });
    }
    return result;
  }

  private toPublic(row: any, aliases: Map<string, { name: string; profile: string | null }>, viewer?: string | null, liked?: Set<string>): PublicListing {
    const alias = aliases.get(row.owner_id);
    return {
      id: row.id, title: row.title, description: row.description || '', category: row.category, tags: row.tags || [],
      creator: alias?.name || ANONYMOUS_CREATOR, creatorProfile: alias?.profile || null, remixable: row.remixable !== false,
      thumbnail: row.thumbnail_path ? `/api/community/listings/${row.id}/thumbnail?v=${encodeURIComponent(String(row.thumbnail_version || '').replace(/\D/g, '').slice(0, 14))}` : null,
      thumbnailAlt: row.thumbnail_alt || `Aperçu de « ${row.title} »`, featured: Boolean(row.featured), likes: row.like_count || 0, remixes: row.remix_count || 0, listedAt: row.listed_at,
      ...(viewer ? { liked: liked?.has(row.id) || false, mine: row.owner_id === viewer } : {}),
    };
  }

  async list(input: { tab: ListTab; category?: string; q?: string; cursor?: string | null; limit?: number; viewer?: string | null }): Promise<{ items: PublicListing[]; nextCursor: string | null }> {
    const limit = Math.max(1, Math.min(PAGE_MAX, Math.floor(input.limit || 24)));
    const column = input.tab === 'trending' ? 'trending_score' : input.tab === 'recent' ? 'listed_at' : 'discover_rank';
    let query = this.client.from('community_listings').select(PUBLIC_COLUMNS).eq('status', 'online');
    if (input.category) query = query.eq('category', input.category);
    const q = sanitizeSearch(input.q || '');
    if (q) {
      const like = `%${q.replace(/[%_]/g, ' ')}%`;
      query = query.or(`search_vector.wfts(simple).${q},title.ilike.${like},creator_alias.ilike.${like},category.ilike.${like}`);
    }
    if (input.cursor) {
      const [value, id] = String(input.cursor).split('|');
      if (value && /^[0-9a-f-]{36}$/i.test(id || '') && /^[0-9TZ:+.\-eE]+$/.test(value)) {
        query = query.or(`${column}.lt.${value},and(${column}.eq.${value},id.lt.${id})`);
      }
    }
    const { data, error } = await query.order(column, { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
    if (error) throw new Error(`community_listings: ${error.message}`);
    const rows = (data || []) as any[];
    const page = rows.slice(0, limit);
    const aliases = await this.aliasFor(page);
    const liked = await this.likedSet(input.viewer, page.map(row => row.id));
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? `${last[column]}|${last.id}` : null;
    return { items: page.map(row => this.toPublic(row, aliases, input.viewer, liked)), nextCursor };
  }

  async publicDetail(id: string, viewer?: string | null) {
    const { data, error } = await this.client.from('community_listings').select(`${PUBLIC_COLUMNS},public_url,view_count,indexable,current_version_id`).eq('id', id).eq('status', 'online').maybeSingle();
    if (error) throw new Error(`community_listings: ${error.message}`);
    if (!data) return null;
    const aliases = await this.aliasFor([data]);
    const liked = await this.likedSet(viewer, [data.id]);
    return { ...this.toPublic(data, aliases, viewer, liked), publicUrl: data.public_url as string | null, views: data.view_count as number, indexable: Boolean(data.indexable) };
  }

  async similar(listing: { id: string; category: string }, limit = 6): Promise<PublicListing[]> {
    const { data } = await this.client.from('community_listings').select(PUBLIC_COLUMNS).eq('status', 'online').eq('category', listing.category).neq('id', listing.id).order('discover_rank', { ascending: false }).limit(limit);
    const rows = (data || []) as any[];
    return rows.map(row => this.toPublic(row, new Map([[row.owner_id, { name: row.creator_alias || ANONYMOUS_CREATOR, profile: null }]])));
  }

  private async likedSet(viewer: string | null | undefined, ids: string[]): Promise<Set<string>> {
    if (!viewer || !ids.length) return new Set();
    const { data } = await this.client.from('community_likes').select('listing_id').eq('user_id', viewer).in('listing_id', ids);
    return new Set((data || []).map((row: any) => row.listing_id));
  }

  // ── Interactions ────────────────────────────────────────────────────────────────────────────────────────────────
  /** One like per person: a second call removes it. Returns the new state and count. */
  async toggleLike(listingId: string, userId: string): Promise<{ liked: boolean; likes: number }> {
    const existing = await this.client.from('community_likes').select('listing_id').eq('listing_id', listingId).eq('user_id', userId).maybeSingle();
    if (existing.data) await this.client.from('community_likes').delete().eq('listing_id', listingId).eq('user_id', userId);
    else {
      const { error } = await this.client.from('community_likes').insert({ listing_id: listingId, user_id: userId });
      // A double click races two inserts: the primary key stops the second, which is exactly one like.
      if (error && error.code !== '23505') throw new Error(`community_likes: ${error.message}`);
    }
    const { count } = await this.client.from('community_likes').select('listing_id', { count: 'exact', head: true }).eq('listing_id', listingId);
    await this.client.from('community_listings').update({ like_count: count || 0 }).eq('id', listingId);
    return { liked: !existing.data, likes: count || 0 };
  }

  /** A view counts once per visitor per day. Returns whether it was new. */
  async recordView(listingId: string, viewerHash: string): Promise<boolean> {
    const { error } = await this.client.from('community_views').insert({ listing_id: listingId, viewer_hash: viewerHash });
    if (error) return false;
    const { count } = await this.client.from('community_views').select('listing_id', { count: 'exact', head: true }).eq('listing_id', listingId);
    await this.client.from('community_listings').update({ view_count: count || 0 }).eq('id', listingId);
    return true;
  }

  async addReport(input: { listing_id: string; reporter_id: string; reason: string; details?: string }): Promise<{ created: boolean }> {
    const { error } = await this.client.from('community_reports').insert({ listing_id: input.listing_id, reporter_id: input.reporter_id, reason: input.reason, details: input.details ? input.details.slice(0, 1000) : null });
    if (error) {
      if (error.code === '23505') return { created: false };
      throw new Error(`community_reports: ${error.message}`);
    }
    return { created: true };
  }

  async openReports(listingId: string): Promise<Array<{ reporter: string; reason: string }>> {
    const { data } = await this.client.from('community_reports').select('reporter_id,reason').eq('listing_id', listingId).eq('status', 'open');
    return (data || []).map((row: any) => ({ reporter: row.reporter_id, reason: row.reason }));
  }

  async resolveReports(listingId: string, status: 'upheld' | 'dismissed') {
    await this.client.from('community_reports').update({ status }).eq('listing_id', listingId).eq('status', 'open');
  }

  async upheldCount(ownerId: string): Promise<number> {
    const { count } = await this.client.from('community_sanctions').select('id', { count: 'exact', head: true }).eq('user_id', ownerId);
    return count || 0;
  }

  async activeSanction(ownerId: string): Promise<{ level: 'warning' | 'suspension' | 'ban'; until: string | null } | null> {
    const { data } = await this.client.from('community_sanctions').select('level,until').eq('user_id', ownerId).order('created_at', { ascending: false }).limit(5);
    const now = Date.now();
    const rows = (data || []) as Array<{ level: 'warning' | 'suspension' | 'ban'; until: string | null }>;
    return rows.find(row => row.level === 'ban') || rows.find(row => row.level === 'suspension' && (!row.until || new Date(row.until).getTime() > now)) || null;
  }

  async addSanction(input: { user_id: string; level: 'warning' | 'suspension' | 'ban'; reason: string; until?: string | null; created_by?: string | null }) {
    await this.client.from('community_sanctions').insert({ user_id: input.user_id, level: input.level, reason: input.reason.slice(0, 400), until: input.until || null, created_by: input.created_by || null });
  }

  async addAppeal(input: { listing_id: string; user_id: string; message: string }): Promise<boolean> {
    const open = await this.client.from('community_appeals').select('id').eq('listing_id', input.listing_id).eq('status', 'open').maybeSingle();
    if (open.data) return false;
    const { error } = await this.client.from('community_appeals').insert({ listing_id: input.listing_id, user_id: input.user_id, message: input.message.slice(0, 1000) });
    if (error) throw new Error(`community_appeals: ${error.message}`);
    return true;
  }

  // ── Remixes ─────────────────────────────────────────────────────────────────────────────────────────────────────
  async remixHistory(userId: string, creatorId: string | null): Promise<{ lastHour: number; lastDay: number; lastDaySameCreator: number }> {
    const hour = new Date(Date.now() - 3_600_000).toISOString();
    const day = new Date(Date.now() - 86_400_000).toISOString();
    const rows = await this.client.from('community_remixes').select('created_at,listing_id').eq('user_id', userId).gte('created_at', day).limit(500);
    const list = (rows.data || []) as Array<{ created_at: string; listing_id: string | null }>;
    let sameCreator = 0;
    if (creatorId) {
      const ids = [...new Set(list.map(item => item.listing_id).filter(Boolean))] as string[];
      if (ids.length) {
        const owners = await this.client.from('community_listings').select('id').in('id', ids).eq('owner_id', creatorId);
        const set = new Set((owners.data || []).map((row: any) => row.id));
        sameCreator = list.filter(item => item.listing_id && set.has(item.listing_id)).length;
      }
    }
    return { lastHour: list.filter(item => item.created_at >= hour).length, lastDay: list.length, lastDaySameCreator: sameCreator };
  }

  async recordRemix(input: { listing_id?: string | null; template_id?: string | null; source_project_id?: string | null; new_project_id: string; user_id: string }) {
    await this.client.from('community_remixes').insert({ listing_id: input.listing_id || null, template_id: input.template_id || null, source_project_id: input.source_project_id || null, new_project_id: input.new_project_id, user_id: input.user_id });
    if (input.listing_id) {
      const { count } = await this.client.from('community_remixes').select('id', { count: 'exact', head: true }).eq('listing_id', input.listing_id);
      await this.client.from('community_listings').update({ remix_count: count || 0 }).eq('id', input.listing_id);
    }
  }

  // ── Ranking maintenance ─────────────────────────────────────────────────────────────────────────────────────────
  async engagementSince(listingIds: string[], sinceIso: string, excludeOwner: Map<string, string>) {
    const out = new Map<string, { views: number; likes: number; remixes: number }>();
    for (const id of listingIds) out.set(id, { views: 0, likes: 0, remixes: 0 });
    if (!listingIds.length) return out;
    const sinceDay = sinceIso.slice(0, 10);
    const [views, likes, remixes] = await Promise.all([
      this.client.from('community_views').select('listing_id').in('listing_id', listingIds).gte('day', sinceDay).limit(50_000),
      this.client.from('community_likes').select('listing_id,user_id').in('listing_id', listingIds).gte('created_at', sinceIso).limit(50_000),
      this.client.from('community_remixes').select('listing_id,user_id').in('listing_id', listingIds).gte('created_at', sinceIso).limit(50_000),
    ]);
    for (const row of views.data || []) out.get(row.listing_id)!.views += 1;
    // The owner's own likes and remixes never move their app up.
    for (const row of likes.data || []) if (row.user_id !== excludeOwner.get(row.listing_id)) out.get(row.listing_id)!.likes += 1;
    for (const row of remixes.data || []) if (row.user_id !== excludeOwner.get(row.listing_id)) out.get(row.listing_id)!.remixes += 1;
    return out;
  }

  async onlineForRanking(limit = 2000): Promise<Array<Pick<ListingRow, 'id' | 'owner_id' | 'quality_score' | 'listed_at' | 'featured'>>> {
    const { data } = await this.client.from('community_listings').select('id,owner_id,quality_score,listed_at,featured').eq('status', 'online').order('listed_at', { ascending: false }).limit(limit);
    return (data || []) as any;
  }

  async setRanks(id: string, trending: number, discover: number) {
    await this.client.from('community_listings').update({ trending_score: trending, discover_rank: discover }).eq('id', id);
  }

  // ── Profiles ────────────────────────────────────────────────────────────────────────────────────────────────────
  async profile(userId: string) {
    const { data } = await this.client.from('community_profiles').select('user_id,display_name,bio,public').eq('user_id', userId).maybeSingle();
    return (data as null | { user_id: string; display_name: string | null; bio: string | null; public: boolean }) || null;
  }

  async saveProfile(userId: string, input: { display_name?: string | null; bio?: string | null; public?: boolean }) {
    const { error } = await this.client.from('community_profiles').upsert({ user_id: userId, ...input, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw new Error(`community_profiles: ${error.message}`);
  }

  // ── Templates ───────────────────────────────────────────────────────────────────────────────────────────────────
  async templates() {
    const { data } = await this.client.from('community_templates').select('slug,title,description,category,version,min_plan,design_score,use_count,position').eq('active', true).order('position', { ascending: true });
    return (data || []) as Array<{ slug: string; title: string; description: string; category: string; version: number; min_plan: string; design_score: number | null; use_count: number; position: number }>;
  }

  async template(slug: string) {
    const { data } = await this.client.from('community_templates').select('slug,title,description,category,brief,version,min_plan,active').eq('slug', slug).maybeSingle();
    return (data as null | { slug: string; title: string; description: string; category: string; brief: string; version: number; min_plan: string; active: boolean }) || null;
  }

  async seedTemplates(rows: Array<{ slug: string; title: string; description: string; category: string; brief: string; position: number; design_score?: number }>) {
    const { data } = await this.client.from('community_templates').select('slug');
    const known = new Set((data || []).map((row: any) => row.slug));
    const fresh = rows.filter(row => !known.has(row.slug));
    if (fresh.length) await this.client.from('community_templates').insert(fresh.map(row => ({ ...row, tested_at: new Date().toISOString() })));
    return fresh.length;
  }

  async bumpTemplateUse(slug: string) {
    const current = await this.client.from('community_templates').select('use_count').eq('slug', slug).maybeSingle();
    await this.client.from('community_templates').update({ use_count: (current.data?.use_count || 0) + 1 }).eq('slug', slug);
  }

  // ── Pending plan notices (paid → free) ──────────────────────────────────────────────────────────────────────────
  async openNotice(ownerId: string) {
    const { data } = await this.client.from('community_plan_notices').select('id,effective_at,notified_at').eq('owner_id', ownerId).is('applied_at', null).is('cancelled_at', null).maybeSingle();
    return (data as null | { id: string; effective_at: string; notified_at: string | null }) || null;
  }

  async createNotice(input: { owner_id: string; organization_id?: string | null; effective_at: string }) {
    const { data, error } = await this.client.from('community_plan_notices').insert({ owner_id: input.owner_id, organization_id: input.organization_id || null, kind: 'downgrade_notice', effective_at: input.effective_at }).select('id').single();
    if (error) throw new Error(`community_plan_notices: ${error.message}`);
    return data.id as string;
  }

  async cancelNotice(ownerId: string) {
    await this.client.from('community_plan_notices').update({ cancelled_at: new Date().toISOString() }).eq('owner_id', ownerId).is('applied_at', null).is('cancelled_at', null);
  }

  async dueNotices(now = new Date()) {
    const { data } = await this.client.from('community_plan_notices').select('id,owner_id,organization_id,effective_at').is('applied_at', null).is('cancelled_at', null).lte('effective_at', now.toISOString()).limit(100);
    return (data || []) as Array<{ id: string; owner_id: string; organization_id: string | null; effective_at: string }>;
  }

  async markNoticeApplied(id: string) {
    await this.client.from('community_plan_notices').update({ applied_at: new Date().toISOString() }).eq('id', id);
  }

  async markNoticeNotified(id: string) {
    await this.client.from('community_plan_notices').update({ notified_at: new Date().toISOString() }).eq('id', id);
  }

  // ── Admin ───────────────────────────────────────────────────────────────────────────────────────────────────────
  async adminOverview(sinceIso: string) {
    const [listings, reports, remixes, appeals, events] = await Promise.all([
      this.client.from('community_listings').select('id,status,origin,status_code,created_at,listed_at,quality_score').limit(20_000),
      this.client.from('community_reports').select('status,reason,created_at').gte('created_at', sinceIso).limit(5000),
      this.client.from('community_remixes').select('id,created_at').gte('created_at', sinceIso).limit(20_000),
      this.client.from('community_appeals').select('id,status').eq('status', 'open').limit(500),
      this.client.from('community_moderation_events').select('id,listing_id,actor_type,event,to_status,code,reason,created_at').order('created_at', { ascending: false }).limit(100),
    ]);
    return { listings: listings.data || [], reports: reports.data || [], remixes: remixes.data || [], appeals: appeals.data || [], events: events.data || [] };
  }

  async adminListings(status: string | null, limit = 100) {
    let query = this.client.from('community_listings').select('id,project_id,owner_id,title,category,origin,status,status_code,status_reason,quality_score,report_count,like_count,remix_count,view_count,featured,listed_at,updated_at').order('updated_at', { ascending: false }).limit(Math.min(200, limit));
    if (status) query = query.eq('status', status);
    const { data } = await query;
    return data || [];
  }
}

export type VerdictApplication = {
  state: ListingState;
  code: string;
  reason: string;
  results: CheckResult[];
};
