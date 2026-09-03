/**
 * Typed provider failures.
 *
 * The gateway used to decide whether a failure was worth retrying by running
 * regexes over the error's message text. That is unsound, and it was failing
 * in production on the most ordinary errors there are:
 *
 *   "OpenRouter HTTP 503: upstream timeout after 40000ms"  -> /400/ matched
 *                                                             "40000" and the
 *                                                             error became a
 *                                                             non-retryable
 *                                                             bad request
 *   "OpenRouter HTTP 500: internal error (req 8402331)"    -> /402/ matched
 *                                                             "8402331" and it
 *                                                             became "insufficient
 *                                                             credits"
 *   "OpenRouter HTTP 529: overloaded, retry after 4029ms"  -> /429/ matched
 *                                                             "4029ms" — right
 *                                                             family, by luck,
 *                                                             wrong reason
 *
 * A status code is a number the provider already gave us. Carrying it instead
 * of embedding it in prose removes the guessing, and with it a whole class of
 * failures where a transient blip was reported to the user as a billing
 * problem and never retried.
 */

/** An HTTP-level failure from a model provider, with the status preserved. */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly provider: string;
  readonly body: string;

  constructor(provider: string, status: number, body: string) {
    super(`${provider} HTTP ${status}: ${body || 'no error body'}`);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.provider = provider;
    this.body = body;
  }
}

/**
 * The request was stopped on purpose.
 *
 * Distinct from a timeout, and the distinction is the point: a timeout is a
 * failure worth retrying and falling back from, while a cancellation is the
 * user saying stop. Retrying one is spending their money against their
 * instruction, so it carries its own type rather than an `AbortError` the
 * classifier read as a timeout.
 */
export class ProviderCancelledError extends Error {
  constructor(message = 'The request was cancelled.') {
    super(message);
    this.name = 'ProviderCancelledError';
  }
}

/** The provider accepted the request but produced nothing within the window. */
export class ProviderTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(provider: string, timeoutMs: number) {
    super(`${provider} did not answer within ${timeoutMs}ms`);
    this.name = 'ProviderTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Whether trying the same request again could plausibly succeed.
 *
 * Decided from the status code alone, because that is what the code is for:
 * 408 (request timeout), 409 (conflict), 429 (rate limited) and every 5xx are
 * the provider saying "not now"; the rest of the 4xx range is it saying "not
 * like this", and repeating an identical malformed request is only slower.
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 409 || status === 429) return true;
  return status >= 500;
}
