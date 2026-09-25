/**
 * The composer's side of attachments and links.
 *
 * Files go to /api/attachments as they are chosen, with real upload progress
 * (XMLHttpRequest reports it, fetch does not), then the server reads them and
 * this module polls until they are ready. Links get a preview card, then a
 * full analysis. A page without a session (the landing) keeps the files in
 * the browser until the Builder, after sign-in, can send them.
 */
import { apiFetch, ApiError } from './api';
import { getVerifiedSession, refreshVerifiedSession } from './supabase-browser';
import { isLocalPreviewEnabled } from '../local-preview';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export type { AttachmentUploader, LinkPreviewResult, RemoteAttachment } from './attachment-types';
export { waitUntilRead } from './attachment-types';
import type { AttachmentUploader, RemoteAttachment } from './attachment-types';

async function accessToken(): Promise<string | null> {
  let verified = await getVerifiedSession();
  if (!verified?.session?.access_token) verified = await refreshVerifiedSession();
  return verified?.session?.access_token || null;
}

export async function hasAttachmentSession(): Promise<boolean> {
  if (isLocalPreviewEnabled()) return false;
  return Boolean(await getVerifiedSession().catch(() => null));
}

function uploadWithProgress(file: File, token: string, projectId: string | undefined, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<RemoteAttachment> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    request.open('POST', `${API_BASE_URL}/api/attachments${query}`);
    request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    request.setRequestHeader('X-File-Type', file.type || '');
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    request.onload = () => {
      let payload: any = null;
      try { payload = JSON.parse(request.responseText || 'null'); } catch { payload = null; }
      if (request.status >= 200 && request.status < 300 && payload?.attachment) resolve(payload.attachment);
      else reject(new ApiError(payload?.error || (request.status === 413 ? 'Fichier trop volumineux.' : 'L’envoi du fichier a échoué.'), request.status, payload));
    };
    request.onerror = () => reject(new ApiError('Connexion perdue pendant l’envoi du fichier.', 0, null));
    request.onabort = () => reject(new DOMException('Envoi annulé.', 'AbortError'));
    signal.addEventListener('abort', () => request.abort(), { once: true });
    request.send(file);
  });
}

/** The uploader for a signed-in surface. `projectId` ties the files to the project from the start. */
export function createAttachmentUploader(options: { projectId?: () => string | undefined } = {}): AttachmentUploader {
  return {
    async upload(file, onProgress, signal) {
      const token = await accessToken();
      if (!token) throw new ApiError('Connectez-vous pour joindre des fichiers.', 401, null);
      return uploadWithProgress(file, token, options.projectId?.(), onProgress, signal);
    },
    async status(id) {
      const payload = await apiFetch<{ attachment: RemoteAttachment }>(`/api/attachments/${encodeURIComponent(id)}`);
      return payload.attachment;
    },
    async remove(id) {
      await apiFetch(`/api/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
    },
    async previewLink(url) {
      const payload = await apiFetch<{ success: boolean; preview?: any; error?: string }>('/api/links/preview', { method: 'POST', body: JSON.stringify({ url }) }).catch((error: Error) => ({ success: false, error: error.message }) as any);
      if (!payload?.success || !payload.preview) return { ok: false, error: payload?.error || 'Aperçu indisponible.' };
      const { title = '', description = '', siteName = '', favicon = '', image = '' } = payload.preview;
      return { ok: true, title, description, siteName, favicon, image };
    },
    async analyzeLink(url, message) {
      const payload = await apiFetch<{ attachment: RemoteAttachment }>('/api/links/analyze', { method: 'POST', body: JSON.stringify({ url, message, projectId: options.projectId?.() }) });
      return payload.attachment;
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Local preview                                                             */
/* ------------------------------------------------------------------------ */

/** `?localPreview=1`: the tray behaves as in production (progress, analysis), nothing is sent. */
export function createPreviewUploader(): AttachmentUploader {
  const records = new Map<string, RemoteAttachment>();
  const make = (patch: Partial<RemoteAttachment>): RemoteAttachment => ({
    id: crypto.randomUUID(), kind: 'document', name: '', mimeType: '', size: 0, status: 'processing', error: null, summary: '', sourceUrl: null, preview: null, thumbnailUrl: null, ...patch,
  });
  const settleLater = (id: string, patch: Partial<RemoteAttachment>, delay: number) => {
    setTimeout(() => { const record = records.get(id); if (record) records.set(id, { ...record, status: 'ready', ...patch }); }, delay);
  };
  return {
    async upload(file, onProgress, signal) {
      for (let step = 1; step <= 10; step += 1) {
        if (signal.aborted) throw new DOMException('Envoi annulé.', 'AbortError');
        await new Promise(resolve => setTimeout(resolve, 90 + Math.min(400, file.size / 200_000)));
        onProgress(step / 10);
      }
      const record = make({ name: file.name, size: file.size, mimeType: file.type });
      records.set(record.id, record);
      settleLater(record.id, { summary: 'Lu dans l’aperçu local' }, 1_400);
      return record;
    },
    async status(id) { return records.get(id) || make({ id, status: 'failed', error: 'Introuvable.' }); },
    async remove(id) { records.delete(id); },
    async previewLink(url) {
      const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })();
      return { ok: true, title: host, description: '', siteName: host, favicon: '/favicon.svg', image: '' };
    },
    async analyzeLink(url) {
      const record = make({ kind: 'link', sourceUrl: url });
      records.set(record.id, record);
      settleLater(record.id, {}, 2_200);
      return record;
    },
  };
}
