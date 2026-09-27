import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError } from './api';

vi.mock('./supabase-browser', () => ({
  getVerifiedSession: vi.fn(async () => ({ session: { access_token: 'test-token' } })),
  refreshVerifiedSession: vi.fn(async () => ({ session: { access_token: 'test-token' } })),
}));

describe('apiFetch streamed errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves the server diagnostic from an SSE response with an HTTP error status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('stream', {
      status: 402,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    })));
    const result = { success: false, diagnostic_code: 'CREDITS_REQUIRED', message: 'Session en pause.' };
    const readResponse = vi.fn(async () => result);

    await expect(apiFetch('/api/projects/p1/generate', { method: 'POST' }, readResponse))
      .rejects.toMatchObject({
        name: 'ApiError',
        status: 402,
        payload: result,
      } satisfies Partial<ApiError>);
    expect(readResponse).toHaveBeenCalledTimes(1);
  });
});
