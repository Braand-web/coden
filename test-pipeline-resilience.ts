import assert from 'node:assert/strict';
import { ProviderGateway } from './src/services/provider-gateway.ts';
import { ProviderCancelledError, ProviderHttpError, ProviderTimeoutError } from './src/services/provider-errors.ts';
import type { AllowedModelId } from './src/config/ai-models.ts';

/**
 * The pipeline under simulated failure.
 *
 * The classifier test proves the verdicts are right; this proves the gateway
 * acts on them — that a transient failure is actually retried, that an
 * unavailable model actually falls back, and above all that a cancellation
 * does neither. The provider is a stub because the failures being simulated
 * are provider failures: what is under test is Coden's response to them.
 */

type Script = Array<'ok' | Error>;

/** A provider that fails on a script, and counts what it was asked to do. */
function fakeProvider(scripts: Partial<Record<string, Script>>) {
  const calls: string[] = [];
  const next = (modelId: string) => {
    calls.push(modelId);
    const script = scripts[modelId];
    const step = script?.shift();
    if (step && step !== 'ok') throw step;
    return modelId;
  };
  return {
    calls,
    service: {
      async chat(modelId: string) {
        next(modelId);
        return { text: 'done', model: modelId, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, cost_usd: 0 };
      },
      async *streamChat(modelId: string) {
        next(modelId);
        yield { type: 'token' as const, text: 'hello', model: modelId };
      },
    } as any,
  };
}

const PINNED: AllowedModelId = 'anthropic/claude-sonnet-5';
const FALLBACK: AllowedModelId = 'openai/gpt-5.6-terra-pro';

// -- 1. a transient provider failure is retried, not surfaced -------------
{
  const provider = fakeProvider({ [PINNED]: [new ProviderHttpError('OpenRouter', 503, 'upstream timeout after 40000ms')] });
  const gateway = new ProviderGateway(provider.service);
  const result = await gateway.chat(PINNED, [{ role: 'user', content: 'hi' }]);
  assert.equal(result.text, 'done');
  assert.deepEqual(provider.calls, [PINNED, PINNED], 'a 503 must be retried on the same model');
}

// -- 2. a model that is genuinely gone falls back to an allowed one --------
{
  const provider = fakeProvider({ [PINNED]: [
    new ProviderHttpError('OpenRouter', 404, 'no endpoints found'),
    new ProviderHttpError('OpenRouter', 404, 'no endpoints found'),
  ] });
  const gateway = new ProviderGateway(provider.service);
  const fallbacks: string[] = [];
  const result = await gateway.chat(PINNED, [{ role: 'user', content: 'hi' }], {
    allowFallback: true,
    onFallback: event => fallbacks.push(event.to),
  });
  assert.equal(result.model, FALLBACK, 'an unavailable model must hand over to its configured fallback');
  assert.deepEqual(fallbacks, [FALLBACK], 'and the handover must be reported, not silent');
}

// -- 3. a timeout is retried; it is what the retries are for --------------
{
  const provider = fakeProvider({ [PINNED]: [new ProviderTimeoutError('OpenRouter', 45_000)] });
  const gateway = new ProviderGateway(provider.service);
  const result = await gateway.chat(PINNED, [{ role: 'user', content: 'hi' }]);
  assert.equal(result.text, 'done');
  assert.equal(provider.calls.length, 2, 'a timeout must be retried once');
}

/**
 * 4. Stop means stop.
 *
 * A cancellation used to be indistinguishable from a timeout, so pressing stop
 * started a retry — and on Auto, a fallback to a second model. The user paid
 * for two more calls by asking for none. Exactly one call must be made here.
 */
{
  const provider = fakeProvider({ [PINNED]: [new ProviderCancelledError(), new ProviderCancelledError()] });
  const gateway = new ProviderGateway(provider.service);
  await assert.rejects(
    () => gateway.chat(PINNED, [{ role: 'user', content: 'hi' }], { allowFallback: true }),
    (error: any) => error.diagnosticCode === 'REQUEST_CANCELLED',
  );
  assert.deepEqual(provider.calls, [PINNED], 'a cancelled request must be attempted exactly once and never fall back');
}

// -- 5. a request the provider refused on its merits is not repeated ------
{
  const provider = fakeProvider({ [PINNED]: [new ProviderHttpError('OpenRouter', 400, 'messages: field required')] });
  const gateway = new ProviderGateway(provider.service);
  await assert.rejects(
    () => gateway.chat(PINNED, [{ role: 'user', content: 'hi' }]),
    (error: any) => error.diagnosticCode === 'PROVIDER_BAD_REQUEST',
  );
  assert.equal(provider.calls.length, 1, 'a malformed request must fail fast rather than back off three times');
}

/**
 * 6. A stream recovers before its first token, and never after.
 *
 * Streams had no retry at all: the loop only moved to the next model, and only
 * when the caller opted into fallback, so one 503 ended a pinned generation
 * before anything reached the screen.
 */
{
  const provider = fakeProvider({ [PINNED]: [new ProviderHttpError('OpenRouter', 502, 'bad gateway')] });
  const gateway = new ProviderGateway(provider.service);
  const tokens: string[] = [];
  for await (const event of gateway.streamChat(PINNED, [{ role: 'user', content: 'hi' }])) {
    if (event.type === 'token') tokens.push(event.text);
  }
  assert.deepEqual(tokens, ['hello'], 'the stream must recover before any token escapes');
  assert.equal(provider.calls.length, 2);
}
{
  // Failing mid-stream is not retryable by construction: restarting would
  // replay the tokens already shown, and nothing downstream can tell the
  // duplicate from the original.
  const service = {
    async *streamChat(modelId: string) {
      yield { type: 'token' as const, text: 'partial', model: modelId };
      throw new ProviderHttpError('OpenRouter', 503, 'connection reset');
    },
  } as any;
  const gateway = new ProviderGateway(service);
  const tokens: string[] = [];
  await assert.rejects(async () => {
    for await (const event of gateway.streamChat(PINNED, [{ role: 'user', content: 'hi' }])) {
      if (event.type === 'token') tokens.push(event.text);
    }
  });
  assert.deepEqual(tokens, ['partial'], 'what was already emitted stays emitted, exactly once');
}

// -- 7. recovery never leaves the authorised catalogue --------------------
{
  const { AI_MODEL_FALLBACKS, AI_ALLOWED_MODELS } = await import('./src/config/ai-models.ts');
  for (const [from, chain] of Object.entries(AI_MODEL_FALLBACKS)) {
    for (const to of chain) {
      assert.ok((AI_ALLOWED_MODELS as string[]).includes(to), `${from} falls back to unauthorised ${to}`);
    }
  }
}

console.log('pipeline resilience tests passed');
