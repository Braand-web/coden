/**
 * The same answer saved twice.
 *
 * An assistant reply is written by the server when the run ends, and again by the client a few seconds later under
 * its own message id — so the two rows never matched on `ai_message_id`, and the conversation showed the answer
 * twice after a reload. Two assistant messages with the same words, a couple of minutes apart at most, are one answer.
 */
export const TWIN_WINDOW_MS = 120_000;

type MessageLike = {
  id?: string;
  role?: string;
  content?: string | null;
  created_at?: string | null;
  ai_message_id?: string | null;
  parts?: unknown[] | null;
  metadata?: { coden_stream?: unknown } | null;
};

const normalise = (text: unknown) => String(text || '').replace(/\s+/g, ' ').trim();

/** Short replies (« Oui ») can be said twice on purpose; only a real sentence is compared. */
const MIN_LENGTH = 12;

export function isTwinMessage(a: MessageLike, b: MessageLike, windowMs = TWIN_WINDOW_MS): boolean {
  if (a.role !== 'assistant' || b.role !== 'assistant') return false;
  const left = normalise(a.content);
  if (left.length < MIN_LENGTH || left !== normalise(b.content)) return false;
  const at = Date.parse(String(a.created_at || ''));
  const bt = Date.parse(String(b.created_at || ''));
  if (!Number.isFinite(at) || !Number.isFinite(bt)) return false;
  return Math.abs(at - bt) <= windowMs;
}

/** Richer wins: the one that kept its stream, its parts, its client id. */
function weight(message: MessageLike): number {
  return (message.metadata?.coden_stream ? 4 : 0) + (message.parts?.length ? 2 : 0) + (message.ai_message_id ? 1 : 0);
}

export function dedupeTwinMessages<T extends MessageLike>(messages: T[]): T[] {
  const kept: T[] = [];
  for (const message of messages) {
    const twin = kept.findIndex(other => isTwinMessage(other, message));
    if (twin === -1) { kept.push(message); continue; }
    if (weight(message) > weight(kept[twin])) kept[twin] = message;
  }
  return kept;
}
