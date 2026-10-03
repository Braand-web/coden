/**
 * The browser side of the Community: types, calls, and the sidebar's « Nouveau » badge.
 * Every call goes through apiFetch (session, errors); nothing here knows a rule — the server decides.
 */
import { apiFetch } from './api';

export type Category = { slug: string; label: string };
export type CardListing = {
  id: string; title: string; description: string; category: string; tags: string[]; creator: string; creatorProfile: string | null;
  remixable: boolean; thumbnail: string | null; thumbnailAlt: string; featured: boolean; likes: number; remixes: number; listedAt: string | null; liked?: boolean; mine?: boolean;
};
export type DetailListing = CardListing & { publicUrl: string | null; views: number; indexable: boolean };
export type ListPage = { items: CardListing[]; nextCursor: string | null };
export type Template = { slug: string; title: string; description: string; category: string; version: number; min_plan: string; use_count: number; likes: number; liked: boolean; official: true; available: boolean; kind: 'app' | 'brief'; thumbnail: string | null; previewUrl: string | null };
export type UseTemplateResult = { title: string; templateId: string; prompt?: string; builderUrl?: string; project?: { id: string; name: string } };
export type OwnerListing = {
  id: string; projectId: string; title: string; description: string; category: string; creatorAlias: string | null; status: string; statusLabel: string;
  statusReason: string | null; statusCode: string | null; origin: 'free_auto' | 'paid_opt_in'; optedIn: boolean; remixable: boolean; featured: boolean; qualityScore: number | null;
  stats: { views: number; likes: number; remixes: number }; thumbnail: string | null; canContest: boolean; updatedAt: string;
};
export type MineResponse = {
  plan: string; controls: { canChoose: boolean; mode: 'automatic' | 'choice' }; listings: OwnerListing[]; categories: Category[];
  notice: { effectiveAt: string } | null; unlisted: string[]; freeNotice: string; profile: { displayName: string; bio: string; public: boolean };
};
export type RemixResult = { project: { id: string; name: string }; builderUrl: string; reconnect: Array<{ key: string; label: string; hint: string }>; attribution: string };

export type Tab = 'discover' | 'trending' | 'recent' | 'templates' | 'mine';
export const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'discover', label: 'Découvrir' },
  { id: 'trending', label: 'Tendances' },
  { id: 'recent', label: 'Nouveautés' },
  { id: 'templates', label: 'Templates Coden' },
  { id: 'mine', label: 'Mes publications' },
];

export const REPORT_REASONS: Record<string, string> = {
  illegal: 'Contenu illégal', adult: 'Contenu pour adultes', hate: 'Haine ou harcèlement', scam: 'Arnaque ou hameçonnage',
  impersonation: 'Usurpation d’une marque ou d’une personne', copyright: 'Droit d’auteur', privacy: 'Données personnelles', spam: 'Spam', other: 'Autre',
};

const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

export const communityApi = {
  config: () => apiFetch<{ enabled: boolean; frozen: boolean }>('/api/community/config'),
  categories: () => apiFetch<{ categories: Category[] }>('/api/community/categories').then(result => result.categories),
  list: (input: { tab: 'discover' | 'trending' | 'recent'; category?: string; q?: string; cursor?: string | null }) => {
    const params = new URLSearchParams({ tab: input.tab, limit: '24' });
    if (input.category) params.set('category', input.category);
    if (input.q) params.set('q', input.q);
    if (input.cursor) params.set('cursor', input.cursor);
    return apiFetch<ListPage>(`/api/community/listings?${params}`);
  },
  detail: (id: string) => apiFetch<{ listing: DetailListing; similar: CardListing[]; categories: Category[] }>(`/api/community/listings/${id}`),
  view: (id: string) => apiFetch<{ counted: boolean }>(`/api/community/listings/${id}/view`, json('POST')),
  like: (id: string) => apiFetch<{ liked: boolean; likes: number }>(`/api/community/listings/${id}/like`, json('POST')),
  report: (id: string, reason: string, details: string) => apiFetch<{ ok: boolean }>(`/api/community/listings/${id}/report`, json('POST', { reason, details })),
  remix: (id: string) => apiFetch<RemixResult>(`/api/community/listings/${id}/remix`, json('POST')),
  appeal: (id: string, message: string) => apiFetch<{ ok: boolean }>(`/api/community/listings/${id}/appeal`, json('POST', { message })),
  templates: () => apiFetch<{ templates: Template[] }>('/api/community/templates').then(result => result.templates),
  likeTemplate: (slug: string) => apiFetch<{ liked: boolean; likes: number }>(`/api/community/templates/${encodeURIComponent(slug)}/like`, json('POST')),
  useTemplate: (slug: string) => apiFetch<UseTemplateResult>(`/api/community/templates/${slug}/use`, json('POST')),
  recordTemplateProject: (slug: string, projectId: string) => apiFetch<{ success: boolean }>(`/api/community/templates/${encodeURIComponent(slug)}/project`, json('POST', { projectId })),
  mine: () => apiFetch<MineResponse>('/api/community/mine'),
  editListing: (projectId: string, patch: Record<string, unknown>) => apiFetch<{ listing: OwnerListing }>(`/api/community/projects/${projectId}/listing`, json('PATCH', patch)),
  refreshThumbnail: (projectId: string) => apiFetch<{ ok: boolean }>(`/api/community/projects/${projectId}/thumbnail/refresh`, json('POST')),
  saveProfile: (profile: { displayName: string; bio: string; public: boolean }) => apiFetch<{ success: boolean }>('/api/community/profile', json('PUT', profile)),
  upgradeClick: () => apiFetch<{ success: boolean }>('/api/community/upgrade-click', json('POST', { from: 'mine' })).catch(() => null),
};

// ── The sidebar badge: « Nouveau » until the Community has been visited once ──
export const COMMUNITY_SEEN_KEY = 'coden-community-seen';
export function communitySeen(): boolean {
  try { return window.localStorage.getItem(COMMUNITY_SEEN_KEY) === '1'; } catch { return true; }
}
export function markCommunitySeen() {
  try { window.localStorage.setItem(COMMUNITY_SEEN_KEY, '1'); } catch { /* storage can be unavailable */ }
}

// ── The hash routes: #community, #community/trending, #community/templates, #community/mine, #community/app/<id> ──
export type CommunityRoute = { tab: Tab; listingId: string | null };
export function parseCommunityHash(hash: string): CommunityRoute | null {
  const match = /^#community(?:\/(trending|recent|templates|mine)|\/app\/([0-9a-f-]{36}))?$/i.exec(hash || '');
  if (!match) return null;
  return { tab: (match[1]?.toLowerCase() as Tab) || 'discover', listingId: match[2] || null };
}
export const communityHash = (route: { tab?: Tab; listingId?: string | null }) =>
  route.listingId ? `#community/app/${route.listingId}` : !route.tab || route.tab === 'discover' ? '#community' : `#community/${route.tab}`;

export function relativeDate(value: string | null): string {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  const days = Math.floor((Date.now() - time) / 86_400_000);
  if (days < 1) return 'aujourd’hui';
  if (days < 30) return `il y a ${days} j`;
  return new Date(time).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
