import { describe, expect, it, vi } from 'vitest';
import { verifyCloudflareDeployment, type PublishResult } from './publish-cloudflare.ts';
import { cloudflareDeploymentVersions, cloudflareWorkerNameForSlug } from './publish-cloudflare-workers.ts';

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

describe('Cloudflare Worker release identity', () => {
  it('uses one deterministic worker name for publish, domains and rollback', () => {
    expect(cloudflareWorkerNameForSlug('My Project / Demo')).toBe('coden-my-project-demo');
    expect(cloudflareWorkerNameForSlug('x'.repeat(100))).toHaveLength(57);
  });

  it('preserves the exact version weights of a historical deployment', () => {
    expect(cloudflareDeploymentVersions({
      versions: [
        { version_id: 'version-a', percentage: 90 },
        { version_id: 'version-b', percentage: 10 },
        { version_id: '', percentage: 100 },
      ],
    })).toEqual([
      { version_id: 'version-a', percentage: 90 },
      { version_id: 'version-b', percentage: 10 },
    ]);
  });
});
