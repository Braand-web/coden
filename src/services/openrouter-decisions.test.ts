import { describe, expect, it, vi } from 'vitest';
import { DECISIONS_CATALOG_URL, DECISIONS_MODEL, DECISIONS_URL, DecisionsError, InternalRoutingBudget,
  OpenRouterDecisions, buildDecisionsRequest, decisionsPricing, validateDecisionAnswers } from './openrouter-decisions.ts';
import { INTENT_QUESTIONS } from './decisions-intent-router.ts';
import { isAllowedModelId } from '../config/ai-models.ts';

const canonicalModel = `${DECISIONS_MODEL}-20261006`;
const catalog = () => ({ data: [{ id: DECISIONS_MODEL, canonical_slug: canonicalModel, context_length: 1_050_000,
  architecture: { output_modalities: ['decisions'] }, pricing: { prompt: '0.0000001', completion: '0' } }] });
function answers() {
  return Object.fromEntries(Object.entries(INTENT_QUESTIONS).map(([name, question]) => question.type === 'noul'
    ? [name, { type: 'noul', noul: 0.01 }]
    : [name, { type: 'choice', choice: Object.keys(question.criteria)[0], confidence: 0.99,
      probabilities: Object.fromEntries(Object.keys(question.criteria).map((key, i) => [key, i === 0 ? 1 : 0])) }]));
}
const reply = (overrides: Record<string, unknown> = {}) => new Response(JSON.stringify({ model: DECISIONS_MODEL,
  provider: 'OpenAI', answers: answers(), usage: { input_tokens: 800, output_tokens: 0, cost: 0.00008 }, ...overrides }));

describe('server-only OpenRouter Decisions transport', () => {
  it('uses the separate endpoint, one inference, price caps and existing server key', async () => {
    const fetcher = vi.fn(async (url: string) => url === DECISIONS_CATALOG_URL ? new Response(JSON.stringify(catalog())) : reply());
    const observe = vi.fn();
    const client = new OpenRouterDecisions({ apiKey: () => 'sk-or-v1-private-value', fetch: fetcher as any, observe });
    const budget = new InternalRoutingBudget();
    const result = await client.decide({ prompt: 'Explain this project' }, INTENT_QUESTIONS, budget);
    expect(result.costUsd).toBe(0.00008);
    expect(budget.used).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, options] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe(DECISIONS_URL);
    expect(options.headers).toMatchObject({ Authorization: 'Bearer sk-or-v1-private-value' });
    const body = JSON.parse(options.body as string);
    expect(body).toMatchObject({ model: DECISIONS_MODEL, provider: { only: ['openai'], allow_fallbacks: false,
      require_parameters: true, max_price: { prompt: 0.1, completion: 0, request: 0 } } });
    expect(body.messages).toBeUndefined(); expect(body.tools).toBeUndefined(); expect(body.stream).toBeUndefined();
    expect(observe.mock.calls[0][0]).toMatchObject({ result: 'succeeded', usage: { prompt_tokens: 800, completion_tokens: 0, cost: 0.00008 } });
    expect(JSON.stringify(result) + JSON.stringify(observe.mock.calls)).not.toContain('sk-or-v1');
    expect(isAllowedModelId(DECISIONS_MODEL)).toBe(false);
  });

  it('validates modality/pricing before spending and refuses unknown or changed prices', () => {
    expect(decisionsPricing(catalog())).toEqual({ prompt: 1e-7, contextLength: 1_050_000, canonicalModel });
    for (const mutate of [
      (c: any) => { c.data = []; }, (c: any) => { delete c.data[0].pricing; },
      (c: any) => { c.data[0].pricing.prompt = ''; },
      (c: any) => { c.data[0].pricing.request = ''; },
      (c: any) => { c.data[0].pricing.overrides = {}; },
      (c: any) => { c.data[0].canonical_slug = 'other/model'; },
      (c: any) => { c.data[0].pricing.completion = '0.01'; },
      (c: any) => { c.data[0].pricing.overrides = [{ prompt: '1' }]; },
      (c: any) => { c.data[0].architecture.output_modalities = ['text']; },
    ]) { const c = catalog(); mutate(c); expect(() => decisionsPricing(c)).toThrow(); }
    expect(() => buildDecisionsRequest('x', INTENT_QUESTIONS, { prompt: 0.01, contextLength: 1_050_000 })).toThrow('BUDGET');
    expect(() => buildDecisionsRequest('x'.repeat(32_001), INTENT_QUESTIONS, decisionsPricing(catalog()))).toThrow('INPUT_LIMIT');
  });

  it('accepts only the dated version verified by the catalogue, not arbitrary aliases', async () => {
    const observe = vi.fn();
    let served = canonicalModel;
    const client = new OpenRouterDecisions({ apiKey: () => 'key', observe,
      fetch: vi.fn(async (url: string) => url === DECISIONS_CATALOG_URL ? new Response(JSON.stringify(catalog()))
        : reply({ model: served })) as any });
    await expect(client.decide({}, INTENT_QUESTIONS, new InternalRoutingBudget())).resolves.toMatchObject({ costUsd: 0.00008 });
    expect(observe.mock.calls[0][0].servedModel).toBe(canonicalModel);
    served = `${DECISIONS_MODEL}-20990101`;
    await expect(client.decide({}, INTENT_QUESTIONS, new InternalRoutingBudget())).rejects.toThrow('MODEL_MISMATCH');
  });

  it('rejects malformed, refused or inconsistent typed decisions', () => {
    expect(validateDecisionAnswers(answers(), INTENT_QUESTIONS).intent.type).toBe('choice');
    const mutations = [
      (a: any) => { delete a.intent; }, (a: any) => { a.intent.type = 'refusal'; },
      (a: any) => { a.intent.choice = 'delete_database'; }, (a: any) => { a.intent.confidence = NaN; },
      (a: any) => { a.intent.probabilities.conversation = 0.5; },
      (a: any) => { a.intent.probabilities.edit = 1; a.intent.probabilities.conversation = 0; },
      (a: any) => { a.planning.noul = -1; }, (a: any) => { a.planning.noul = '1'; },
      (a: any) => { a.intent.probabilities.unknown = 0; },
    ];
    for (const mutate of mutations) { const a = answers(); mutate(a); expect(() => validateDecisionAnswers(a, INTENT_QUESTIONS)).toThrow('INVALID_RESPONSE'); }
  });

  it.each([
    { model: 'other/model' }, { model: undefined }, { provider: 'sk-or-v1-echoed-secret' },
  ])('records paid usage but never trusts/echoes a foreign model/provider: %j', async payload => {
    const observe = vi.fn();
    const client = new OpenRouterDecisions({ apiKey: () => 'key', observe,
      fetch: vi.fn(async (url: string) => url === DECISIONS_CATALOG_URL ? new Response(JSON.stringify(catalog()))
        : reply(payload)) as any });
    await expect(client.decide({}, INTENT_QUESTIONS, new InternalRoutingBudget())).rejects.toThrow('MODEL_MISMATCH');
    expect(observe.mock.calls[0][0]).toMatchObject({ result: 'failed', usage: { cost: 0.00008 } });
    expect(observe.mock.calls[0][0].servedModel).toBe('unknown');
    expect(JSON.stringify(observe.mock.calls)).not.toContain('sk-or-v1');
  });

  it('does not retry provider errors or expose error bodies, and opens its breaker', async () => {
    const fetcher = vi.fn(async (url: string) => url === DECISIONS_CATALOG_URL ? new Response(JSON.stringify(catalog()))
      : new Response('private prompt and sk-or-v1-secret', { status: 429 }));
    const client = new OpenRouterDecisions({ apiKey: () => 'key', fetch: fetcher as any, observe: vi.fn() });
    for (let i = 0; i < 3; i++) {
      await expect(client.decide({}, INTENT_QUESTIONS, new InternalRoutingBudget())).rejects.toThrow('DECISIONS_HTTP_429');
    }
    await expect(client.decide({}, INTENT_QUESTIONS, new InternalRoutingBudget())).rejects.toThrow('CIRCUIT_OPEN');
    expect(fetcher.mock.calls.filter(([url]) => url === DECISIONS_URL)).toHaveLength(3);
  });

  it('has no paid request without a key, known catalogue or remaining budget', async () => {
    const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify(catalog())));
    const unconfigured = new OpenRouterDecisions({ apiKey: () => '', fetch: fetcher as any });
    await expect(unconfigured.decide({}, INTENT_QUESTIONS, new InternalRoutingBudget())).rejects.toThrow('NOT_CONFIGURED');
    expect(fetcher).not.toHaveBeenCalled();
    const client = new OpenRouterDecisions({ apiKey: () => 'key', fetch: fetcher as any });
    const budget = new InternalRoutingBudget(); budget.claim(); budget.claim();
    await expect(client.decide({}, INTENT_QUESTIONS, budget)).rejects.toThrow('CALL_LIMIT');
    expect(fetcher.mock.calls.every(call => call[0] === DECISIONS_CATALOG_URL)).toBe(true);
  });

  it('does not let rejected oversized inputs open the global provider breaker', async () => {
    const fetcher = vi.fn(async (url: string) => url === DECISIONS_CATALOG_URL ? new Response(JSON.stringify(catalog())) : reply());
    const client = new OpenRouterDecisions({ apiKey: () => 'key', fetch: fetcher as any, observe: vi.fn() });
    for (let i = 0; i < 3; i++) {
      await expect(client.decide('x'.repeat(32_001), INTENT_QUESTIONS, new InternalRoutingBudget())).rejects.toThrow('INPUT_LIMIT');
    }
    await expect(client.decide({}, INTENT_QUESTIONS, new InternalRoutingBudget())).resolves.toMatchObject({ costUsd: 0.00008 });
    expect(fetcher.mock.calls.filter(([url]) => url === DECISIONS_URL)).toHaveLength(1);
  });

  it('caches verified catalogue prices, singleflights concurrent refreshes, and expires them', async () => {
    let now = 1000;
    const fetcher = vi.fn(async (url: string) => url === DECISIONS_CATALOG_URL ? new Response(JSON.stringify(catalog())) : reply());
    const client = new OpenRouterDecisions({ apiKey: () => 'key', fetch: fetcher as any, now: () => now });
    await Promise.all([1, 2].map(() => client.decide({}, INTENT_QUESTIONS, new InternalRoutingBudget())));
    expect(fetcher.mock.calls.filter(([url]) => url === DECISIONS_CATALOG_URL)).toHaveLength(1);
    now += 300_001;
    await client.decide({}, INTENT_QUESTIONS, new InternalRoutingBudget());
    expect(fetcher.mock.calls.filter(([url]) => url === DECISIONS_CATALOG_URL)).toHaveLength(2);
  });

  it('respects timeout and explicit cancellation without a retry', async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url === DECISIONS_CATALOG_URL) return new Response(JSON.stringify(catalog()));
      return new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
    });
    const client = new OpenRouterDecisions({ apiKey: () => 'key', fetch: fetcher as any });
    await expect(client.decide({}, INTENT_QUESTIONS, new InternalRoutingBudget(), { timeoutMs: 250 })).rejects.toMatchObject({ name: 'ProviderTimeoutError' });
    const controller = new AbortController();
    const pending = client.decide({}, INTENT_QUESTIONS, new InternalRoutingBudget(), { signal: controller.signal });
    await vi.waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url === DECISIONS_URL)).toHaveLength(2));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'ProviderCancelledError' });
  });

  it('caps concurrent inference and rejects excessively large responses', async () => {
    let finish: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const fetcher = vi.fn(async (url: string) => {
      if (url === DECISIONS_CATALOG_URL) return new Response(JSON.stringify(catalog()));
      await gate; return reply();
    });
    const client = new OpenRouterDecisions({ apiKey: () => 'key', fetch: fetcher as any });
    const pending = [1, 2, 3, 4].map(() => client.decide({}, INTENT_QUESTIONS, new InternalRoutingBudget()));
    await expect(client.decide({}, INTENT_QUESTIONS, new InternalRoutingBudget())).rejects.toThrow('BUSY');
    finish!(); await Promise.all(pending);
    const huge = new OpenRouterDecisions({ apiKey: () => 'key', fetch: vi.fn(async (url: string) => url === DECISIONS_CATALOG_URL
      ? new Response(JSON.stringify(catalog())) : new Response('x'.repeat(65_000))) as any });
    await expect(huge.decide({}, INTENT_QUESTIONS, new InternalRoutingBudget())).rejects.toThrow('RESPONSE_LIMIT');
  });
});
