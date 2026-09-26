/**
 * The sidebar badge for Suggestions, without loading the page: posts
 * published since the member's last visit, and unread status changes on
 * what they wrote or voted for.
 */
import { apiFetch } from './api';

export const SUGGESTIONS_SEEN_KEY = 'coden-suggestions-seen-at';

export function suggestionsSeenAt(): string | null {
  try { return window.localStorage.getItem(SUGGESTIONS_SEEN_KEY); } catch { return null; }
}

export function markSuggestionsSeen() {
  try { window.localStorage.setItem(SUGGESTIONS_SEEN_KEY, new Date().toISOString()); } catch { /* storage can be unavailable */ }
}

export type SuggestionsSummary = { new_posts: number; unread: number; first_visit: boolean };

export async function fetchSuggestionsSummary(): Promise<SuggestionsSummary> {
  const since = suggestionsSeenAt();
  const result = await apiFetch<{ new_posts: number; unread: number }>(`/api/feedback/summary${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  return { new_posts: Number(result.new_posts) || 0, unread: Number(result.unread) || 0, first_visit: !since };
}

/** What the badge says: unread status changes first, then new posts, then "Nouveau" before the first visit. */
export function suggestionsBadge(summary: SuggestionsSummary | null | undefined): string | null {
  if (!summary) return null;
  const count = summary.unread + summary.new_posts;
  if (count > 0) return count > 9 ? '9+' : String(count);
  return summary.first_visit ? 'Nouveau' : null;
}
