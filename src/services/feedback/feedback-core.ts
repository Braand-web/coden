/**
 * Suggestions board: what a post and a reply may contain, how a member is
 * named in public, how posts are ranked, and which ones look alike.
 *
 * Pure — the routes in server.ts load rows and call these, and the page
 * reuses the labels. Nothing here trusts the browser.
 */

export type FeedbackType = 'feature' | 'bug';
export type FeedbackStatus = 'new' | 'under_review' | 'planned' | 'in_progress' | 'done' | 'declined' | 'duplicate';
export type FeedbackSort = 'trending' | 'top' | 'discussed' | 'recent';

export const FEEDBACK_TYPES: Record<FeedbackType, string> = { feature: 'Fonctionnalité', bug: 'Bug' };
export const FEEDBACK_STATUSES: Record<FeedbackStatus, string> = {
  new: 'Nouveau',
  under_review: 'À l’étude',
  planned: 'Prévu',
  in_progress: 'En cours',
  done: 'Livré',
  declined: 'Refusé',
  duplicate: 'Doublon',
};
export const FEEDBACK_SORTS: Record<FeedbackSort, string> = { trending: 'Tendances', top: 'Plus votées', discussed: 'Plus commentées', recent: 'Récentes' };

/** Posts and replies a member may publish per day, and reports per hour. */
export const FEEDBACK_LIMITS = { postsPerDay: 5, commentsPerDay: 30, votesPerMinute: 60, reportsPerHour: 20 } as const;

export type FeedbackPostRow = {
  id: string;
  author_id: string | null;
  author_name: string;
  type: FeedbackType;
  title: string;
  body: string;
  private: boolean;
  status: FeedbackStatus;
  duplicate_of: string | null;
  attachment_path?: string | null;
  vote_count: number;
  paid_vote_count: number;
  comment_count: number;
  report_count: number;
  pinned: boolean;
  hidden_at: string | null;
  status_changed_at: string | null;
  last_activity_at: string;
  created_at: string;
};

/**
 * Text as it will be stored: no control characters (line breaks kept), no
 * bidirectional overrides that could disguise a link, runs of blank lines
 * squeezed, trimmed. It is shown escaped, never as HTML.
 */
export function cleanText(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

export type PostDraft = { type: FeedbackType; title: string; body: string; private: boolean; attachment_id: string | null };
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export function validatePost(input: any): Checked<PostDraft> {
  const type = input?.type === 'bug' ? 'bug' : input?.type === 'feature' ? 'feature' : null;
  if (!type) return { ok: false, error: 'Choisissez Fonctionnalité ou Bug.' };
  const title = cleanText(input?.title, 200).replace(/\s+/g, ' ');
  if (title.length < 8) return { ok: false, error: 'Le titre doit faire au moins 8 caractères.' };
  if (title.length > 120) return { ok: false, error: 'Le titre ne doit pas dépasser 120 caractères.' };
  const body = cleanText(input?.body, 6000);
  if (body.length > 5000) return { ok: false, error: 'La description ne doit pas dépasser 5 000 caractères.' };
  if (type === 'bug' && body.length < 10) return { ok: false, error: 'Décrivez le bug : ce que vous faisiez, ce qui s’est passé, ce que vous attendiez.' };
  const attachment = input?.attachment_id ? String(input.attachment_id) : null;
  if (attachment && !isUuid(attachment)) return { ok: false, error: 'Capture d’écran invalide.' };
  // Only a bug can be marked as a security issue, which keeps it private.
  return { ok: true, value: { type, title, body, private: type === 'bug' && input?.security === true, attachment_id: attachment } };
}

export function validateComment(input: any): Checked<string> {
  const body = cleanText(input?.body, 3500);
  if (!body) return { ok: false, error: 'La réponse est vide.' };
  if (body.length > 3000) return { ok: false, error: 'La réponse ne doit pas dépasser 3 000 caractères.' };
  return { ok: true, value: body };
}

/**
 * How a member appears: first name and the initial of the last name
 * ("Marie D."), from the name they gave. Never the e-mail address — without
 * a name, "Membre Coden".
 */
export function publicDisplayName(user: any): string {
  const meta = user?.user_metadata || {};
  const given = cleanText(meta.full_name || meta.name || [meta.first_name, meta.last_name].filter(Boolean).join(' ') || '', 80);
  if (!given || given.includes('@')) return 'Membre Coden';
  // Letters, apostrophes and hyphens only: a name is not a place for markup or links.
  const raw = given.replace(/[^\p{L}\p{M}'’\- ]/gu, '').replace(/\s+/g, ' ').trim();
  const parts = raw.split(' ').filter(part => /\p{L}/u.test(part));
  if (!parts.length) return 'Membre Coden';
  const first = parts[0].slice(0, 24);
  const first_ = first.charAt(0).toLocaleUpperCase('fr') + first.slice(1);
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return last ? `${first_} ${last.charAt(0).toLocaleUpperCase('fr')}.` : first_;
}

/**
 * "Tendances": votes and replies weigh, and they fade with age so a week-old
 * post with ten votes does not sit above yesterday's with eight forever.
 */
export function trendingScore(post: Pick<FeedbackPostRow, 'vote_count' | 'comment_count' | 'created_at' | 'last_activity_at'>, now = Date.now()): number {
  const created = Date.parse(post.created_at) || now;
  const active = Date.parse(post.last_activity_at) || created;
  const ageHours = Math.max(0, (now - created) / 3_600_000);
  const idleHours = Math.max(0, (now - active) / 3_600_000);
  const weight = 1 + Math.max(0, post.vote_count) + 0.5 * Math.max(0, post.comment_count);
  return weight / Math.pow(ageHours + 2, 0.9) / Math.pow(1 + idleHours / 72, 0.5);
}

const OPEN_LAST: Record<FeedbackStatus, number> = { new: 0, under_review: 0, planned: 0, in_progress: 0, done: 1, declined: 2, duplicate: 3 };

export function sortPosts<T extends FeedbackPostRow>(posts: T[], sort: FeedbackSort, now = Date.now()): T[] {
  const time = (value: string) => Date.parse(value) || 0;
  const by: Record<FeedbackSort, (a: T, b: T) => number> = {
    trending: (a, b) => OPEN_LAST[a.status] - OPEN_LAST[b.status] || trendingScore(b, now) - trendingScore(a, now),
    top: (a, b) => b.vote_count - a.vote_count || b.comment_count - a.comment_count || time(b.created_at) - time(a.created_at),
    discussed: (a, b) => b.comment_count - a.comment_count || b.vote_count - a.vote_count || time(b.created_at) - time(a.created_at),
    recent: (a, b) => time(b.created_at) - time(a.created_at),
  };
  // Pinned posts first, whatever the order.
  return [...posts].sort((a, b) => Number(b.pinned) - Number(a.pinned) || by[sort](a, b));
}

const STOP = new Set('le la les un une des de du d l et ou en au aux a à pour par sur dans avec sans ne pas plus que qui quoi est sont être avoir faire peut pouvoir je tu il elle on nous vous ils elles mon ma mes ton ta tes son sa ses ce cet cette ces the and for with from into this that coden'.split(' '));

export function titleTokens(title: string): string[] {
  return [...new Set(title
    .toLocaleLowerCase('fr')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(word => word.length > 2 && !STOP.has(word))
    .map(word => word.replace(/(s|x)$/, '')))];
}

/** Open posts whose title shares enough words with the one being typed. */
export function similarPosts<T extends Pick<FeedbackPostRow, 'id' | 'title' | 'status'>>(title: string, posts: T[], limit = 5): Array<T & { similarity: number }> {
  const wanted = titleTokens(title);
  if (wanted.length < 1) return [];
  return posts
    .filter(post => post.status !== 'duplicate')
    .map(post => {
      const tokens = titleTokens(post.title);
      const shared = wanted.filter(word => tokens.some(token => token === word || (word.length > 4 && token.length > 4 && (token.startsWith(word) || word.startsWith(token))))).length;
      const similarity = shared / Math.max(wanted.length, 2);
      return { ...post, similarity: Math.round(similarity * 100) / 100 };
    })
    .filter(post => post.similarity >= 0.34)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/** Who may see a post: everyone, except hidden ones (team only) and private security bugs (author and team). */
export function canSeePost(post: Pick<FeedbackPostRow, 'author_id' | 'private' | 'hidden_at'>, viewer: { id: string; admin: boolean }): boolean {
  if (viewer.admin) return true;
  if (post.hidden_at) return false;
  if (post.private) return post.author_id === viewer.id;
  return true;
}

/** A post as a member receives it: no author id, no moderation data. */
export function publicPost(post: FeedbackPostRow, viewer: { id: string; admin: boolean; voted: boolean }) {
  return {
    id: post.id,
    type: post.type,
    title: post.title,
    body: post.body,
    private: post.private,
    status: post.status,
    duplicate_of: post.duplicate_of,
    author_name: post.author_name,
    mine: Boolean(post.author_id && post.author_id === viewer.id),
    vote_count: post.vote_count,
    comment_count: post.comment_count,
    pinned: post.pinned,
    voted: viewer.voted,
    has_attachment: Boolean(post.attachment_path),
    status_changed_at: post.status_changed_at,
    created_at: post.created_at,
    last_activity_at: post.last_activity_at,
    ...(viewer.admin ? { paid_vote_count: post.paid_vote_count, report_count: post.report_count, hidden: Boolean(post.hidden_at), author_id: post.author_id } : {}),
  };
}
