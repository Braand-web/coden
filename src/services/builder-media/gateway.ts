import type { MediaGateway, MediaInput, MediaModel } from './contracts.ts';

export async function boundedBytes(response: Response, max = 25 * 1024 * 1024): Promise<Uint8Array> {
  if (!response.ok || Number(response.headers.get('content-length') || 0) > max || !response.body) throw new Error('MEDIA_DOWNLOAD_UNAVAILABLE');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length;
      if (size > max) throw new Error('MEDIA_FILE_TOO_LARGE'); chunks.push(next.value); }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** Credentials and supplier payloads never leave this adapter. No automatic POST retry. */
export class BuilderMediaGateway implements MediaGateway {
  constructor(private env: Record<string, string | undefined>, private request: typeof fetch = fetch) {}
  private key(model: MediaModel) {
    const value = model.provider === 'fal' ? this.env.FAL_API_KEY || this.env.FAL_KEY : this.env.OPENROUTER_API_KEY;
    if (!value) throw new Error('MEDIA_NOT_CONFIGURED'); return value;
  }
  private async json(model: MediaModel, url: string, method = 'GET', body?: unknown) {
    const response = await this.request(url, { method, redirect: 'error', signal: AbortSignal.timeout(90_000),
      headers: { Authorization: `${model.provider === 'fal' ? 'Key' : 'Bearer'} ${this.key(model)}`, 'Content-Type': 'application/json',
        ...(model.provider === 'fal' ? { 'X-Fal-No-Retry': '1' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error('MEDIA_PROVIDER_UNAVAILABLE');
    const text = new TextDecoder().decode(await boundedBytes(response, 35 * 1024 * 1024));
    try { return JSON.parse(text); } catch { throw new Error('MEDIA_RESPONSE_INVALID'); }
  }
  private output(data: any) {
    const item = data?.images?.[0] || data?.image || data?.video || data?.videos?.[0];
    const url = typeof item === 'string' ? item : item?.url;
    if (typeof url !== 'string') throw new Error('MEDIA_RESULT_MISSING');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !/(^|\.)fal\.(media|ai|run)$/.test(parsed.hostname)) throw new Error('MEDIA_DOWNLOAD_UNAVAILABLE');
    return { url };
  }
  async submit(model: MediaModel, input: MediaInput) {
    if (model.provider === 'fal') {
      const data = await this.json(model, `https://queue.fal.run/${model.model}`, 'POST', {
        prompt: input.prompt, aspect_ratio: input.ratio,
        ...(model.kind === 'image' ? { num_images: 1, output_format: 'png' } : { duration: String(input.duration), generate_audio: false }),
      });
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(data?.request_id || '')) throw new Error('MEDIA_ACKNOWLEDGEMENT_MISSING');
      return { requestId: data.request_id as string };
    }
    if (model.kind === 'video') {
      const data = await this.json(model, 'https://openrouter.ai/api/v1/videos', 'POST', {
        model: model.model, prompt: input.prompt, duration: input.duration, aspect_ratio: input.ratio, resolution: '720p',
      });
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(data?.id || '')) throw new Error('MEDIA_ACKNOWLEDGEMENT_MISSING');
      return { requestId: data.id as string };
    }
    const data = await this.json(model, 'https://openrouter.ai/api/v1/images', 'POST', {
      model: model.model, prompt: input.prompt, n: 1, aspect_ratio: input.ratio,
    });
    const encoded = data?.data?.[0]?.b64_json;
    if (typeof encoded !== 'string' || encoded.length > 34 * 1024 * 1024 || !/^[a-zA-Z0-9+/=]+$/.test(encoded)) throw new Error('MEDIA_RESULT_MISSING');
    return { bytes: new Uint8Array(Buffer.from(encoded, 'base64')), costUsd: Number(data?.usage?.cost) || undefined };
  }
  async poll(model: MediaModel, requestId: string) {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(requestId)) throw new Error('MEDIA_JOB_INVALID');
    if (model.provider === 'fal') {
      // Queue requests use the base endpoint family in their returned request URLs.
      const base = model.model.split('/').slice(0, 2).join('/');
      const root = `https://queue.fal.run/${base}/requests/${encodeURIComponent(requestId)}`;
      const status = await this.json(model, `${root}/status`);
      if (status.status !== 'COMPLETED') return { status: 'pending' as const };
      if (status.error) return { status: 'failed' as const };
      const data = await this.json(model, root);
      return { status: 'completed' as const, ...this.output(data) };
    }
    const root = `https://openrouter.ai/api/v1/videos/${encodeURIComponent(requestId)}`;
    const status = await this.json(model, root);
    if (['failed', 'cancelled', 'expired'].includes(status.status)) return { status: 'failed' as const };
    if (status.status !== 'completed') return { status: 'pending' as const };
    const response = await this.request(`${root}/content?index=0`, { redirect: 'error', signal: AbortSignal.timeout(90_000), headers: { Authorization: `Bearer ${this.key(model)}` } });
    return { status: 'completed' as const, bytes: await boundedBytes(response), costUsd: Number(status?.usage?.cost) || undefined };
  }
}
