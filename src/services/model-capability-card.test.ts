import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { buildCapabilityCard, cacheSavingRatio, clearProbeResults, probeResultsFor, recordProbeResults, unsupportedParameters } from './model-capability-card';
import { createGatewayProbeChat, needleHaystack, PROBE_RED_PNG, probePdfBase64, runConformanceProbes, type ProbeChat } from './model-conformance';
import type { CatalogModel } from './openrouter-capabilities';

const catalog = (models: CatalogModel[]) => ({
  loaded: models.length > 0,
  peek: (id: string) => models.find(model => model.id === id),
});

const LIVE: CatalogModel = {
  id: 'anthropic/claude-sonnet-5',
  name: 'Anthropic: Claude Sonnet 5',
  context_length: 1_000_000,
  supported_parameters: ['tools', 'tool_choice', 'reasoning', 'include_reasoning', 'structured_outputs', 'response_format', 'temperature', 'max_tokens'],
  architecture: { input_modalities: ['text', 'image', 'file'], output_modalities: ['text'] },
  top_provider: { context_length: 1_000_000, max_completion_tokens: 128_000 },
  pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003', input_cache_write: '0.00000375' },
};

afterEach(() => clearProbeResults());

describe('the capability card', () => {
  it('is filled from the live catalogue, with prices per million tokens including the cache tiers', () => {
    const card = buildCapabilityCard('anthropic/claude-sonnet-5', catalog([LIVE]));
    expect(card).toMatchObject({ available: true, source: 'live', contextLength: 1_000_000, maxCompletionTokens: 128_000 });
    expect(card.modalities.input).toEqual(['text', 'image', 'file']);
    expect(card.parameters).toMatchObject({ tools: true, toolChoice: true, reasoning: true, structuredOutputs: true, parallelToolCalls: null });
    expect(card.pricing).toEqual({ inputUsdPerMillion: 3, outputUsdPerMillion: 15, cacheReadUsdPerMillion: 0.3, cacheWriteUsdPerMillion: 3.75, reasoningUsdPerMillion: null });
    expect(card.provenance).toEqual({ context: 'live', modalities: 'live', parameters: 'live', pricing: 'live' });
    // A cache hit is worth 90 % of the input price here.
    expect(cacheSavingRatio(card)).toBeCloseTo(0.9, 5);
  });

  it('says so when it is only the fallback, and when the catalogue does not list the slug', () => {
    const offline = buildCapabilityCard('anthropic/claude-sonnet-5', catalog([]));
    expect(offline.source).toBe('declared');
    expect(offline.provenance.pricing).toBe('declared');
    expect(offline.available).toBe(true);
    const missing = buildCapabilityCard('anthropic/claude-sonnet-5', catalog([{ ...LIVE, id: 'other/model' }]));
    expect(missing.available).toBe(false);
    expect(missing.drift).toContain('absent from the live catalogue');
  });

  it('reports where the registry and the provider disagree', () => {
    const drifted = buildCapabilityCard('anthropic/claude-sonnet-5', catalog([{
      ...LIVE,
      supported_parameters: ['temperature'],
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      context_length: 200_000,
      top_provider: { context_length: 200_000, max_completion_tokens: 8_000 },
      pricing: { prompt: '0.000003', completion: '0.00003' },
    }]));
    expect(drifted.drift.join(' | ')).toMatch(/declared to read images/);
    expect(drifted.drift.join(' | ')).toMatch(/does not list `tools`/);
    expect(drifted.drift.join(' | ')).toMatch(/context window 200,000/);
    expect(drifted.drift.join(' | ')).toMatch(/output price \$30\/M/);
  });

  it('lists the parameters a request wants that the model does not accept', () => {
    const card = buildCapabilityCard('anthropic/claude-sonnet-5', catalog([LIVE]));
    expect(unsupportedParameters(card, ['tools', 'temperature', 'logit_bias', 'top_k'])).toEqual(['logit_bias', 'top_k']);
    // Nothing is claimed from the fallback: it cannot know.
    expect(unsupportedParameters(buildCapabilityCard('anthropic/claude-sonnet-5', catalog([])), ['logit_bias'])).toEqual([]);
  });

  it('keeps what the probes proved on the card', () => {
    recordProbeResults('anthropic/claude-sonnet-5', [{ name: 'tools', status: 'passed', at: '2026-09-30T00:00:00Z' }]);
    expect(buildCapabilityCard('anthropic/claude-sonnet-5', catalog([LIVE])).probes.tools?.status).toBe('passed');
    expect(probeResultsFor('other')).toEqual({});
  });
});

describe('the probe fixtures', () => {
  it('embeds a real red image', async () => {
    const buffer = Buffer.from(PROBE_RED_PNG, 'base64');
    const stats = await sharp(buffer).stats();
    expect(stats.channels[0].mean).toBeGreaterThan(200);
    expect(stats.channels[1].mean).toBeLessThan(60);
  });

  it('builds a valid PDF whose text a reader can extract', async () => {
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const bytes = Uint8Array.from(Buffer.from(probePdfBase64(), 'base64'));
    const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const text = (await page.getTextContent()).items.map((item: any) => item.str).join(' ');
    expect(text).toContain('CODEN-PROBE-7');
  });

  it('hides its needle in a haystack of about the requested size', () => {
    const text = needleHaystack(20_000);
    expect(text).toContain('TANGERINE-4417');
    expect(text.length / 3.6).toBeGreaterThan(18_000);
    expect(text.length / 3.6).toBeLessThan(22_000);
  });
});

describe('the conformance probes', () => {
  const card = buildCapabilityCard('anthropic/claude-sonnet-5', catalog([LIVE]));
  const call = (name: string, args: unknown) => ({ id: name, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } });

  /** A model that does everything it announces. */
  const capable: ProbeChat = async (_id, messages, options = {}) => {
    const last = messages.at(-1)!;
    const content = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
    if (options.tools?.some(tool => tool.name === 'record_number')) return { text: '', tool_calls: [call('record_number', { n: 42 })] };
    if (options.tools?.some(tool => tool.name === 'get_weather')) return { text: '', tool_calls: [call('get_weather', { city: 'Paris' }), call('get_weather', { city: 'Lyon' })] };
    if (options.json) return { text: '{"ok": true, "n": 3}' };
    if (content.includes('image_url')) return { text: 'Red' };
    if (content.includes('probe.pdf')) return { text: 'CODEN-PROBE-7' };
    if (content.includes('17 + 25')) return { text: '42' };
    if (content.includes('access code')) return { text: 'TANGERINE-4417' };
    if (messages[0].role === 'system') return { text: 'OK', usage: { prompt_tokens: 2_600, cached_tokens: messages.length && probeCalls++ > 0 ? 2_500 : 0 } };
    return { text: 'PONG' };
  };
  let probeCalls = 0;

  it('passes a model that does what it announces', async () => {
    probeCalls = 0;
    const results = await runConformanceProbes({ modelId: 'anthropic/claude-sonnet-5', card, chat: capable, longContextTokens: 10_000 });
    const by = Object.fromEntries(results.map(result => [result.name, result.status]));
    expect(by).toEqual({ simple: 'passed', streaming: 'passed', image: 'passed', pdf: 'passed', tools: 'passed', parallel_tools: 'passed', reasoning: 'passed', json: 'passed', long_context: 'passed', prompt_cache: 'passed' });
  });

  it('fails a probe that a model announces and does not deliver, and never throws', async () => {
    const flaky: ProbeChat = async (id, messages, options) => {
      if (options?.tools) return { text: 'I would rather answer in text.' };
      if (options?.reasoningLevel === 'high') throw new Error('400 reasoning effort not supported');
      return capable(id, messages, options);
    };
    probeCalls = 0;
    const results = await runConformanceProbes({ modelId: 'anthropic/claude-sonnet-5', card, chat: flaky });
    const by = Object.fromEntries(results.map(result => [result.name, result]));
    expect(by.tools.status).toBe('failed');
    expect(by.tools.detail).toBe('no tool call');
    expect(by.parallel_tools.status).toBe('failed');
    expect(by.reasoning.status).toBe('failed');
    expect(by.reasoning.detail).toMatch(/not supported/);
    expect(by.simple.status).toBe('passed');
  });

  it('skips what the model does not announce, with the reason, and the costly probe unless asked', async () => {
    const textOnly = buildCapabilityCard('anthropic/claude-sonnet-5', catalog([{ ...LIVE, supported_parameters: ['temperature'], architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0.000003', completion: '0.000015' } }]));
    probeCalls = 0;
    const results = await runConformanceProbes({ modelId: 'anthropic/claude-sonnet-5', card: textOnly, chat: capable });
    const by = Object.fromEntries(results.map(result => [result.name, result]));
    for (const name of ['image', 'pdf', 'tools', 'parallel_tools', 'reasoning', 'json', 'prompt_cache']) expect(by[name].status).toBe('skipped');
    expect(by.image.detail).toMatch(/does not announce image/);
    expect(by.long_context.status).toBe('skipped');
    expect(by.long_context.detail).toMatch(/costly probe/);
    expect(by.simple.status).toBe('passed');
  });

  it('can run a single probe', async () => {
    const results = await runConformanceProbes({ modelId: 'anthropic/claude-sonnet-5', card, chat: capable, only: ['simple'] });
    expect(results.map(result => result.name)).toEqual(['simple']);
  });

  it('runs against the real gateway with no fallback, so the model under test is the one that answers', async () => {
    const seen: any[] = [];
    const gateway = {
      chat: async (modelId: string, _messages: unknown, options: any) => { seen.push({ modelId, options }); return { text: 'PONG', model: modelId, usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }; },
      streamingCompletion: async (modelId: string, _messages: unknown, options: any) => { seen.push({ modelId, options, stream: true }); return { text: 'PONG', model: modelId, usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }; },
    };
    const chat = createGatewayProbeChat(gateway as any);
    await chat('anthropic/claude-sonnet-5', [{ role: 'user', content: 'hi' }]);
    await chat('anthropic/claude-sonnet-5', [{ role: 'user', content: 'hi' }], { stream: true });
    expect(seen.every(entry => entry.options.allowFallback === false && entry.options.maxAttempts === 1)).toBe(true);
    expect(seen.map(entry => Boolean(entry.stream))).toEqual([false, true]);
  });
});
