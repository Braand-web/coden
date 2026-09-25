import { describe, expect, it } from 'vitest';
import type { CatalogModel } from './openrouter-capabilities';
import { modelAvailability, OpenRouterCapabilities } from './openrouter-capabilities';
import { buildOpenRouterRequest } from './openrouter-request';
import { buildVisionMessageContent } from './openrouter-service';
import { pickModelFor } from './attachments/media-helpers';

const entry = (id: string, modalities: string[]): CatalogModel => ({
  id,
  context_length: 200_000,
  supported_parameters: ['max_tokens'],
  architecture: { input_modalities: modalities },
  top_provider: { context_length: 200_000, max_completion_tokens: 16_000 },
});

describe('media in model requests', () => {
  const content = buildVisionMessageContent('Reproduis ce comportement.', [
    { url: 'data:image/jpeg;base64,AAAA', detail: 'low' },
    { url: 'https://storage.example/demo.mp4?token=x', kind: 'video' },
    { url: 'http://insecure.example/demo.mp4', kind: 'video' },
  ]);

  it('sends a video as a video part, over https only, beside its frames', () => {
    expect(content.map(part => part.type)).toEqual(['text', 'image_url', 'video_url']);
  });

  it('keeps the video for a model that reads video', () => {
    const body = buildOpenRouterRequest(entry('google/gemini-3.8-flash', ['text', 'image', 'video', 'audio', 'file']), 'medium', [{ role: 'user', content }]) as any;
    expect(body.messages[0].content.map((part: any) => part.type)).toEqual(['text', 'image_url', 'video_url']);
  });

  it('drops the video (the frames stay) for a model that does not read video', () => {
    const body = buildOpenRouterRequest(entry('anthropic/claude-sonnet-5', ['text', 'image']), 'medium', [{ role: 'user', content }]) as any;
    expect(body.messages[0].content.map((part: any) => part.type)).toEqual(['text', 'image_url']);
  });

  it('still refuses an image for a model that cannot see (the gateway then picks another)', () => {
    expect(() => buildOpenRouterRequest(entry('text/only', ['text']), 'medium', [{ role: 'user', content }])).toThrow(/cannot accept image_url/);
  });

  it('reports video, audio and file support from the live catalogue', async () => {
    const catalog = new OpenRouterCapabilities((async () => new Response(JSON.stringify({ data: [entry('google/gemini-3.8-flash', ['text', 'image', 'video', 'audio', 'file']), entry('anthropic/claude-sonnet-5', ['text', 'image'])] }))) as typeof fetch);
    await catalog.ensure();
    expect(modelAvailability('google/gemini-3.8-flash', undefined, catalog)).toMatchObject({ supportsVision: true, supportsVideo: true, supportsAudio: true, supportsFile: true });
    expect(modelAvailability('anthropic/claude-sonnet-5', undefined, catalog)).toMatchObject({ supportsVision: true, supportsVideo: false, supportsAudio: false });
    expect(pickModelFor('audio', ['anthropic/claude-sonnet-5', 'google/gemini-3.8-flash'], catalog)).toBe('google/gemini-3.8-flash');
    expect(pickModelFor('video', ['anthropic/claude-sonnet-5'], catalog)).toBeNull();
  });
});
