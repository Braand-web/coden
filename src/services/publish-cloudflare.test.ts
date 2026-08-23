import { describe, expect, it, vi } from 'vitest';
import { verifyCloudflareDeployment, type PublishResult } from './publish-cloudflare.ts';

const result: PublishResult = {
  provider: 'cloudflare-workers',
  runtime: 'static-assets',
  cfName: 'coden-demo',
  subdomain: 'demo.coden.fun',
  defaultUrl: 'https://demo.coden.fun',
  codenUrl: 'https://demo.coden.fun',
  deploymentId: 'deployment-1',
  deploymentUrl: 'https://demo.coden.fun',
};

describe('Cloudflare deployment verification', () => {
  it('requires every selected route to answer successfully', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const verification = await verifyCloudflareDeployment(result, ['/', '/pricing'], fetchMock);
    expect(verification.verified).toBe(true);
    expect(verification.checks).toHaveLength(2);
  });

  it('does not accept a failed deployment check', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response('error', { status: 503 })) as unknown as typeof fetch;
    const promise = verifyCloudflareDeployment(result, ['/'], fetchMock);
    await vi.runAllTimersAsync();
    const verification = await promise;
    expect(verification.verified).toBe(false);
    vi.useRealTimers();
  });
});
