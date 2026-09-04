import assert from 'node:assert/strict';
import { ProviderGateway } from './src/services/provider-gateway.ts';
import {
  ProviderCancelledError,
  ProviderHttpError,
  ProviderTimeoutError,
  isRetryableStatus,
} from './src/services/provider-errors.ts';

/**
 * Why generations were failing.
 *
 * The gateway decided whether a provider failure was worth retrying by running
 * regexes over the error's message text, and the patterns were unanchored
 * substrings. Every one of these ordinary, transient failures was therefore
 * classified as permanent, so the retry and fallback machinery — which is fully
 * built — never fired, and the user was told something false about why:
 *
 *   HTTP 503 "...after 40000ms"      /400/ matched "40000"   -> BAD_REQUEST
 *   HTTP 500 "...(req 8402331)"      /402/ matched "8402331" -> OUT OF CREDITS
 *   HTTP 529 "...retry after 4029ms" /429/ matched "4029"    -> rate limited
 *
 * A status code is a number the provider already gave us. This pins that we
 * read it instead of guessing at it.
 */

const gateway = new ProviderGateway({} as any);
const classify = (error: unknown) => (gateway as any).classifyError(error, 'anthropic/claude-sonnet-5');

// -- the failures that used to be misread ---------------------------------
const transient: Array<[number, string]> = [
  [503, 'upstream timeout after 40000ms'],
  [500, 'internal error (req 8402331)'],
  [529, 'overloaded_error, retry after 4029ms'],
  [502, 'provider returned no response in 14000ms'],
  [504, 'gateway timeout'],
];
for (const [status, body] of transient) {
  const out = classify(new ProviderHttpError('OpenRouter', status, body));
  assert.equal(out.retryable, true, `HTTP ${status} must be retryable, got ${out.diagnosticCode}`);
  assert.notEqual(out.diagnosticCode, 'PROVIDER_BAD_REQUEST', `HTTP ${status} is not a bad request`);
  assert.notEqual(out.diagnosticCode, 'PROVIDER_QUOTA_OR_BILLING', `HTTP ${status} is not a billing problem`);
}

// -- and the ones that genuinely are permanent ----------------------------
// Retrying these is pure cost: the provider will refuse an identical request
// again, and the user waits through the backoff to be told the same thing.
const permanent: Array<[number, string, string]> = [
  [400, 'messages: field required', 'PROVIDER_BAD_REQUEST'],
  [401, 'invalid api key', 'OPENROUTER_KEY_INVALID'],
  [402, 'insufficient credits', 'PROVIDER_QUOTA_OR_BILLING'],
];
for (const [status, body, code] of permanent) {
  const out = classify(new ProviderHttpError('OpenRouter', status, body));
  assert.equal(out.retryable, false, `HTTP ${status} must not be retried`);
  assert.equal(out.diagnosticCode, code);
}

// A rejected *option* is recoverable by dropping the option; a rejected
// request is not. Both arrive as 400.
assert.equal(
  classify(new ProviderHttpError('OpenRouter', 400, 'unsupported parameter: response_format')).diagnosticCode,
  'PROVIDER_UNSUPPORTED_RUNTIME_CONFIG',
);
assert.equal(classify(new ProviderHttpError('OpenRouter', 400, 'unsupported parameter: response_format')).retryable, false);

// 404 is the model, not the request: another model can serve it.
assert.equal(classify(new ProviderHttpError('OpenRouter', 404, 'no endpoints found')).diagnosticCode, 'MODEL_UNAVAILABLE');
assert.equal(classify(new ProviderHttpError('OpenRouter', 429, 'rate limit')).diagnosticCode, 'PROVIDER_RATE_LIMITED');

// The provider is named, so the remedy names the right key.
assert.equal(classify(new ProviderHttpError('Anthropic', 401, 'x-api-key invalid')).diagnosticCode, 'ANTHROPIC_KEY_INVALID');

/**
 * Stop means stop.
 *
 * A cancellation and a timeout both surface as an AbortError, and the
 * classifier read both as a timeout — which is retryable. So pressing stop
 * started a retry, and on Auto a fallback to a second model: the user paid for
 * two more calls by asking for none.
 */
const cancelled = classify(new ProviderCancelledError());
assert.equal(cancelled.diagnosticCode, 'REQUEST_CANCELLED');
assert.equal(cancelled.retryable, false, 'a cancelled request must never be retried');

const timedOut = classify(new ProviderTimeoutError('OpenRouter', 90_000));
assert.equal(timedOut.diagnosticCode, 'PROVIDER_TIMEOUT');
assert.equal(timedOut.retryable, true, 'a timeout is exactly what retries are for');

// -- the rule itself ------------------------------------------------------
for (const status of [408, 409, 429, 500, 502, 503, 504, 529]) {
  assert.equal(isRetryableStatus(status), true, `${status} should be retryable`);
}
for (const status of [400, 401, 402, 403, 404, 422]) {
  assert.equal(isRetryableStatus(status), false, `${status} should not be retryable`);
}

/**
 * The trap must stay disarmed.
 *
 * The remaining text rules exist for callers that still throw plain Errors. If
 * a bare status number goes back into one of those patterns, the same class of
 * misreading returns — silently, and only in production.
 */
const source = (await import('node:fs')).readFileSync('./src/services/provider-gateway.ts', 'utf8');
const textRules = source.slice(source.indexOf('private classifyError'));
for (const forbidden of ['/400|', '/402|', '/404|', '/429|', '/401|403|']) {
  assert.ok(!textRules.includes(forbidden), `status codes must not be matched as substrings of free text: found ${forbidden}`);
}

console.log('provider error classification tests passed');
