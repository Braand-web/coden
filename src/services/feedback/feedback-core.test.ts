import { describe, expect, it } from 'vitest';
import { canSeePost, cleanText, publicDisplayName, publicPost, similarPosts, sortPosts, trendingScore, validateComment, validatePost, type FeedbackPostRow } from './feedback-core';
import { suggestionsBadge } from '../../lib/suggestions-summary';
import { feedbackCsv, supportScore } from '../../admin-feedback';

const NOW = Date.parse('2026-09-26T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const post = (patch: Partial<FeedbackPostRow>): FeedbackPostRow => ({
  id: patch.id || 'p', author_id: 'u-author', author_name: 'Marie D.', type: 'feature', title: 'Une idée', body: '', private: false, status: 'new', duplicate_of: null,
  vote_count: 0, paid_vote_count: 0, comment_count: 0, report_count: 0, pinned: false, hidden_at: null, status_changed_at: null,
  last_activity_at: hoursAgo(1), created_at: hoursAgo(1), ...patch,
});

describe('suggestions: what may be published', () => {
  it('cleans text: control and bidi characters out, line breaks kept', () => {
    expect(cleanText('a‮b\u0000c\r\nd\n\n\n\ne ', 100)).toBe('abc\nd\n\ne');
    expect(cleanText('x'.repeat(50), 10)).toHaveLength(10);
  });

  it('validates a post by type', () => {
    expect(validatePost({ type: 'idea', title: 'Exporter en ZIP' })).toMatchObject({ ok: false });
    expect(validatePost({ type: 'feature', title: 'court' })).toMatchObject({ ok: false });
    expect(validatePost({ type: 'feature', title: 'x'.repeat(121) })).toMatchObject({ ok: false });
    expect(validatePost({ type: 'bug', title: 'Aperçu blanc au rechargement', body: '' })).toMatchObject({ ok: false });
    expect(validatePost({ type: 'feature', title: '  Exporter   un projet en ZIP ', security: true })).toEqual({ ok: true, value: { type: 'feature', title: 'Exporter un projet en ZIP', body: '', private: false, attachment_id: null } });
    expect(validatePost({ type: 'bug', title: 'Fuite de session entre comptes', body: 'Je vois le projet d’un autre compte.', security: true })).toMatchObject({ ok: true, value: { private: true } });
    expect(validatePost({ type: 'bug', title: 'Aperçu blanc au rechargement', body: 'Il reste blanc après une modification.', attachment_id: '../../etc' })).toMatchObject({ ok: false });
  });

  it('validates a reply', () => {
    expect(validateComment({ body: '   ' })).toMatchObject({ ok: false });
    expect(validateComment({ body: 'y'.repeat(3001) })).toMatchObject({ ok: false });
    expect(validateComment({ body: ' Merci ! ' })).toEqual({ ok: true, value: 'Merci !' });
  });

  it('names a member by first name and initial, never by e-mail', () => {
    expect(publicDisplayName({ user_metadata: { full_name: 'marie dupont' } })).toBe('Marie D.');
    expect(publicDisplayName({ user_metadata: { name: 'Kofi' } })).toBe('Kofi');
    expect(publicDisplayName({ email: 'secret@example.com', user_metadata: {} })).toBe('Membre Coden');
    expect(publicDisplayName({ user_metadata: { full_name: 'secret@example.com' } })).toBe('Membre Coden');
    expect(publicDisplayName({ user_metadata: { full_name: '<img src=x> 123' } })).toBe('Img S.');
    expect(publicDisplayName({ user_metadata: { full_name: 'Aïcha Ben-Salah' } })).toBe('Aïcha B.');
  });
});

describe('suggestions: who sees what', () => {
  const member = { id: 'u-other', admin: false };
  it('hides private security bugs and moderated posts', () => {
    expect(canSeePost(post({}), member)).toBe(true);
    expect(canSeePost(post({ private: true }), member)).toBe(false);
    expect(canSeePost(post({ private: true }), { id: 'u-author', admin: false })).toBe(true);
    expect(canSeePost(post({ hidden_at: hoursAgo(1) }), { id: 'u-author', admin: false })).toBe(false);
    expect(canSeePost(post({ private: true, hidden_at: hoursAgo(1) }), { id: 'x', admin: true })).toBe(true);
  });

  it('never sends the author id or moderation data to a member', () => {
    const shown = publicPost(post({ report_count: 3, paid_vote_count: 2 }), { ...member, voted: true });
    expect(shown).not.toHaveProperty('author_id');
    expect(shown).not.toHaveProperty('report_count');
    expect(shown).not.toHaveProperty('paid_vote_count');
    expect(shown).toMatchObject({ mine: false, voted: true });
    expect(publicPost(post({}), { id: 'u-author', admin: false, voted: false }).mine).toBe(true);
    expect(publicPost(post({ report_count: 3 }), { id: 'a', admin: true, voted: false })).toMatchObject({ report_count: 3, author_id: 'u-author' });
  });
});

describe('suggestions: ranking', () => {
  it('lets recent activity beat old votes in Tendances, and keeps closed posts last', () => {
    const old = post({ id: 'old', vote_count: 20, created_at: hoursAgo(24 * 30), last_activity_at: hoursAgo(24 * 20) });
    const fresh = post({ id: 'fresh', vote_count: 6, comment_count: 2, created_at: hoursAgo(10), last_activity_at: hoursAgo(1) });
    const done = post({ id: 'done', status: 'done', vote_count: 100, created_at: hoursAgo(5) });
    expect(trendingScore(fresh, NOW)).toBeGreaterThan(trendingScore(old, NOW));
    expect(sortPosts([old, done, fresh], 'trending', NOW).map(item => item.id)).toEqual(['fresh', 'old', 'done']);
    expect(sortPosts([old, done, fresh], 'top', NOW).map(item => item.id)).toEqual(['done', 'old', 'fresh']);
    expect(sortPosts([old, done, fresh], 'discussed', NOW)[0].id).toBe('fresh');
    expect(sortPosts([old, done, post({ id: 'pin', pinned: true, created_at: hoursAgo(900) })], 'recent', NOW)[0].id).toBe('pin');
  });

  it('finds posts that already say the same thing', () => {
    const posts = [
      post({ id: 'zip', title: 'Exporter un projet en ZIP' }),
      post({ id: 'dark', title: 'Thème sombre pour les apps générées' }),
      post({ id: 'dup', title: 'Export des projets', status: 'duplicate' }),
    ];
    expect(similarPosts('Exporter mes projets en zip', posts).map(item => item.id)).toEqual(['zip']);
    expect(similarPosts('Mode sombre', posts).map(item => item.id)).toEqual(['dark']);
    expect(similarPosts('Facturation annuelle', posts)).toEqual([]);
  });

  it('weighs support for the team: paying voters twice, replies half', () => {
    expect(supportScore({ vote_count: 10, paid_vote_count: 4, comment_count: 6 })).toBe(17);
  });
});

describe('suggestions: sidebar badge and export', () => {
  it('shows unread changes and new posts, "Nouveau" before the first visit', () => {
    expect(suggestionsBadge({ new_posts: 2, unread: 1, first_visit: false })).toBe('3');
    expect(suggestionsBadge({ new_posts: 20, unread: 0, first_visit: false })).toBe('9+');
    expect(suggestionsBadge({ new_posts: 0, unread: 0, first_visit: true })).toBe('Nouveau');
    expect(suggestionsBadge({ new_posts: 0, unread: 0, first_visit: false })).toBeNull();
    expect(suggestionsBadge(null)).toBeNull();
  });

  it('exports CSV that a spreadsheet will not run as a formula', () => {
    const text = feedbackCsv([{ title: '=HYPERLINK("http://x")', type: 'bug', status: 'new', vote_count: 1, paid_vote_count: 0, comment_count: 0, report_count: 0, author_name: '@Marie', created_at: hoursAgo(1) }]);
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(text).toContain(`"'@Marie"`);
  });
});
