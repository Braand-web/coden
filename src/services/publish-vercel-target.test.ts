import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishProjectToVercel } from './publish-vercel.ts';

describe('creating the candidate deployment', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("sends no `target`: Vercel rejects 'preview', and a deployment without a target is a preview", async () => {
    vi.stubEnv('VERCEL_TOKEN', 'test-token');
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'coden-target-'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><body><main>Bonjour</main></body></html>');
    const calls: Array<{ url: string; body: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init: any = {}) => {
      const url = String(input);
      let body: any = null;
      try { body = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch { /* binary upload */ }
      calls.push({ url, body });
      const payload = url.includes('/v13/deployments/') ? { id: 'dpl_1', url: 'x.vercel.app', readyState: 'READY', projectId: 'prj_1' }
        : url.includes('/v13/deployments') ? { id: 'dpl_1', url: 'x.vercel.app' } : {};
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    try {
      await publishProjectToVercel({ slug: 'mon-app', distDir: dist, runtime: 'static-assets' });
    } finally {
      fs.rmSync(dist, { recursive: true, force: true });
    }
    const creation = calls.find(call => /\/v13\/deployments(\?|$)/.test(call.url) && call.body);
    expect(creation).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(creation!.body, 'target')).toBe(false);
  });
});
