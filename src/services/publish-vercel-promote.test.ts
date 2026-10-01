import { afterEach, describe, expect, it, vi } from 'vitest';
import { promoteVercelDeployment } from './publish-vercel.ts';

const answer = (status: number, message: string) => vi.fn(async () => new Response(JSON.stringify({ error: { message } }), { status, headers: { 'content-type': 'application/json' } }));

describe('promoting a staged deployment', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('treats « already the current production deployment » as done (first deployment of a project)', async () => {
    vi.stubEnv('VERCEL_TOKEN', 'test-token');
    vi.stubGlobal('fetch', answer(400, 'The provided deploymentId (dpl_abc) is already the current production deployment.'));
    await expect(promoteVercelDeployment('coden-x', 'dpl_abc')).resolves.toBeUndefined();
  });

  it('still fails on any other provider error', async () => {
    vi.stubEnv('VERCEL_TOKEN', 'test-token');
    vi.stubGlobal('fetch', answer(403, 'Not authorized'));
    await expect(promoteVercelDeployment('coden-x', 'dpl_abc')).rejects.toThrow(/not authorized/i);
  });
});
