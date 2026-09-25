/**
 * The composer's contract with the attachment API, without the API client:
 * the composer is also on the landing, which must not load it.
 */

export type RemoteAttachment = {
  id: string;
  kind: string;
  name: string;
  mimeType: string;
  size: number;
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  summary: string;
  sourceUrl: string | null;
  preview: { title?: string; description?: string; favicon?: string; image?: string; siteName?: string } | null;
  thumbnailUrl: string | null;
};

export type LinkPreviewResult = { ok: true; title: string; description: string; siteName: string; favicon: string; image: string } | { ok: false; error: string };

export type AttachmentUploader = {
  upload(file: File, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<RemoteAttachment>;
  status(id: string): Promise<RemoteAttachment>;
  remove(id: string): Promise<void>;
  previewLink(url: string): Promise<LinkPreviewResult>;
  analyzeLink(url: string, message: string): Promise<RemoteAttachment>;
};

/** Waits until the server has read an attachment (or gives up after `timeoutMs`). */
export async function waitUntilRead(uploader: AttachmentUploader, id: string, timeoutMs = 120_000, onUpdate?: (attachment: RemoteAttachment) => void): Promise<RemoteAttachment> {
  const deadline = Date.now() + timeoutMs;
  let delay = 700;
  while (true) {
    const attachment = await uploader.status(id);
    onUpdate?.(attachment);
    if (attachment.status !== 'processing' || Date.now() > deadline) return attachment;
    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(2_500, delay * 1.3);
  }
}
