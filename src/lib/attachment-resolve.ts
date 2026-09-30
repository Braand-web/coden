/**
 * Fresh links for the attachments a message carries.
 *
 * A message stores the attachment's id, name, type and size — never a link, which would expire. The conversation asks for
 * the thumbnail and the original when it draws the message, once per attachment, cached for most of the hour a link lives.
 */
import type { RemoteAttachment } from './attachment-types';

const TTL_MS = 50 * 60_000;
const cache = new Map<string, { at: number; value: RemoteAttachment | null }>();
const inflight = new Map<string, Promise<void>>();

export async function resolveAttachments(ids: string[]): Promise<Map<string, RemoteAttachment>> {
  const now = Date.now();
  const wanted = [...new Set(ids.filter(id => /^[0-9a-f-]{36}$/i.test(id)))];
  const missing = wanted.filter(id => { const hit = cache.get(id); return !hit || now - hit.at > TTL_MS; });
  const waiting = wanted.filter(id => inflight.has(id)).map(id => inflight.get(id)!);
  const fetchIds = missing.filter(id => !inflight.has(id));
  if (fetchIds.length) {
    const request = (async () => {
      try {
        const { apiFetch } = await import('./api');
        const payload = await apiFetch<{ attachments: RemoteAttachment[] }>('/api/attachments/resolve', { method: 'POST', body: JSON.stringify({ ids: fetchIds }) });
        const found = new Map((payload.attachments || []).map(item => [item.id, item]));
        for (const id of fetchIds) cache.set(id, { at: Date.now(), value: found.get(id) || null });
      } catch {
        // A failure is remembered for a moment only, so a flaky network does not hammer the endpoint.
        for (const id of fetchIds) cache.set(id, { at: Date.now() - TTL_MS + 20_000, value: null });
      } finally {
        for (const id of fetchIds) inflight.delete(id);
      }
    })();
    for (const id of fetchIds) inflight.set(id, request);
    waiting.push(request);
  }
  await Promise.all(waiting);
  const result = new Map<string, RemoteAttachment>();
  for (const id of wanted) { const hit = cache.get(id)?.value; if (hit) result.set(id, hit); }
  return result;
}

/** Test seam. */
export function clearAttachmentCache(): void { cache.clear(); inflight.clear(); }
