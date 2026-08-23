import { redactSecrets } from './secret-redaction.ts';
import type { CodenMediaModelDefinition, CodenMediaSettings } from './media-model-registry.ts';

export type FalMediaAsset = {
  type: 'image' | 'video';
  url: string;
  width?: number;
  height?: number;
  contentType?: string;
};

export type FalMediaResult = {
  provider: 'fal.ai';
  status: 'completed' | 'queued' | 'not_configured';
  requestId?: string;
  assets: FalMediaAsset[];
  rawPublic?: Record<string, unknown>;
};

export class FalMediaGateway {
  private apiKey: string;

  constructor(env: Record<string, string | undefined>) {
    this.apiKey = String(env.FAL_API_KEY || env.FAL_KEY || env.FAL_TOKEN || '').trim();
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async generate(input: {
    model: CodenMediaModelDefinition;
    settings: CodenMediaSettings;
    prompt: string;
    timeoutMs?: number;
  }): Promise<FalMediaResult> {
    if (!this.isConfigured()) {
      return {
        provider: 'fal.ai',
        status: 'not_configured',
        assets: [],
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs || 90_000);
    try {
      const response = await fetch(`https://fal.run/${input.model.endpointId}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildFalPayload(input.prompt, input.settings, input.model)),
        signal: controller.signal,
      });
      const text = await response.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { text: redactSecrets(text).slice(0, 600) };
      }
      if (!response.ok) {
        const error = new Error(redactSecrets(data?.detail || data?.message || data?.error || `fal.ai HTTP ${response.status}`)) as any;
        error.statusCode = response.status;
        error.diagnosticCode = response.status === 401 || response.status === 403
          ? 'FAL_KEY_INVALID'
          : response.status === 429
            ? 'FAL_RATE_LIMITED'
            : response.status >= 500
              ? 'FAL_UNAVAILABLE'
              : 'FAL_REQUEST_REJECTED';
        throw error;
      }

      const assets = extractFalAssets(data);
      return {
        provider: 'fal.ai',
        status: assets.length ? 'completed' : 'queued',
        requestId: String(data?.request_id || data?.requestId || data?.id || ''),
        assets,
        rawPublic: {
          request_id: data?.request_id || data?.requestId || data?.id || null,
          status: assets.length ? 'completed' : 'queued',
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildFalPayload(prompt: string, settings: CodenMediaSettings, model: CodenMediaModelDefinition) {
  const aspectRatio = settings.format;
  const seconds = Number(settings.duration.replace('s', '')) || 8;
  if (model.output === 'image') {
    return {
      prompt,
      aspect_ratio: aspectRatio,
      num_images: 1,
      output_format: 'png',
    };
  }
  return {
    prompt,
    aspect_ratio: aspectRatio,
    duration: `${seconds}`,
    seconds,
    generate_audio: settings.kind === 'ugc' || settings.kind === 'video_ad',
  };
}

function extractFalAssets(data: any): FalMediaAsset[] {
  const assets: FalMediaAsset[] = [];
  const pushImage = (item: any) => {
    const url = typeof item === 'string' ? item : item?.url;
    if (!url) return;
    assets.push({
      type: 'image',
      url: String(url),
      width: Number(item?.width) || undefined,
      height: Number(item?.height) || undefined,
      contentType: item?.content_type || item?.contentType || 'image/png',
    });
  };
  const pushVideo = (item: any) => {
    const url = typeof item === 'string' ? item : item?.url;
    if (!url) return;
    assets.push({
      type: 'video',
      url: String(url),
      width: Number(item?.width) || undefined,
      height: Number(item?.height) || undefined,
      contentType: item?.content_type || item?.contentType || 'video/mp4',
    });
  };

  if (Array.isArray(data?.images)) data.images.forEach(pushImage);
  if (data?.image) pushImage(data.image);
  if (Array.isArray(data?.videos)) data.videos.forEach(pushVideo);
  if (data?.video) pushVideo(data.video);
  if (data?.output?.url) {
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(String(data.output.url));
    if (isVideo) pushVideo(data.output);
    else pushImage(data.output);
  }
  if (data?.url) {
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(String(data.url));
    if (isVideo) pushVideo(data.url);
    else pushImage(data.url);
  }
  return assets;
}
