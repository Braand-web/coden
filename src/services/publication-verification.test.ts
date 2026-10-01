import { describe, expect, it, vi } from 'vitest';
import { verifyVercelDeployment } from './publish-vercel.ts';

const targets = { codenUrl: null, defaultUrl: '', deploymentUrl: 'https://release.coden-test.pages.dev' };
const hash = 'a'.repeat(64);
const document = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const probe = (html: string, missingAsset = false) => vi.fn(async (input: string | URL | Request) => {
  const asset = String(input).includes('/assets/');
  return new Response(asset ? 'export const app = true;' : html, { status: asset && missingAsset ? 404 : 200, headers: { 'content-type': asset ? 'application/javascript' : 'text/html' } });
});

describe('verification of the exact published application', () => {
  it('accepts a Vite/React root with its entry script in the head, and checks its assets', async () => {
    const fetcher = probe(document(`<meta name="coden-build" content="${hash}"><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">`, '<div id="root"></div>'));
    const result = await verifyVercelDeployment(targets, ['/', '/dashboard'], fetcher, { expectedPublicationId: hash });
    expect(result.verified).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/assets/app.js'), expect.anything());
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/assets/app.css'), expect.anything());
    expect(result.checks).toHaveLength(2);
  });
  it('rejects an empty document even if it has a publication marker', async () => {
    expect((await verifyVercelDeployment(targets, ['/'], probe(document(`<meta name="coden-build" content="${hash}">`, '<div id="root"></div>')), { expectedPublicationId: hash })).verified).toBe(false);
  });
  it('rejects stale HTML and missing JavaScript rather than calling a broken site published', async () => {
    const stale = await verifyVercelDeployment(targets, ['/'], probe(document('', '<main>Old version</main>')), { expectedPublicationId: hash });
    expect(stale.checks[0].error).toBe('STALE_APP_ARTIFACT');
    const missing = await verifyVercelDeployment(targets, ['/'], probe(document('<script type="module" src="/assets/app.js"></script>', '<div id="root"></div>'), true));
    expect(missing.checks[0].error).toBe('MISSING_APP_ASSET');
  });
});
