import { describe, expect, it } from 'vitest';
import {
  codenHostForSlug,
  codenRootDomain,
  codenSubdomainForSlug,
  hostingProviderForTarget,
  resolveCloudflareHostingTarget,
  workersDevUrl,
} from './cloudflare-hosting-policy.ts';

describe('Cloudflare hosting policy', () => {
  it('never downgrades a full-stack manifest to Pages', () => {
    expect(resolveCloudflareHostingTarget('cloudflare-workers', 'cloudflare-pages')).toBe('workers-fullstack');
  });

  it('never downgrades a Node server to static hosting', () => {
    expect(() => resolveCloudflareHostingTarget('node-server', 'cloudflare-pages')).toThrow(/Railway deployment adapter/i);
  });

  /*
   * A static app goes where it can actually be deployed.
   *
   * This used to require Workers by default, and no app Coden generates could
   * ever satisfy it: `runWranglerDeploy` spawns
   * `<projectDir>/node_modules/.bin/wrangler` and reads a wrangler config
   * beside it, while `starters.ts` pins React, Vite, Tailwind and TypeScript
   * and neither of those. So every publish threw "does not include a pinned
   * Wrangler dependency" before reaching Cloudflare — deterministically, since
   * the feature shipped. Zero deployments in the database, and no Coden worker
   * in the Cloudflare account: the same fact from both ends.
   */
  it('sends a static app carrying Wrangler to Workers', () => {
    const target = resolveCloudflareHostingTarget('static-assets', '', { hasWranglerBinary: true, hasWranglerConfig: true });
    expect(target).toBe('workers-static-assets');
    expect(hostingProviderForTarget('workers-static-assets')).toBe('cloudflare-workers');
  });

  it('sends a static app without Wrangler to Pages, which needs nothing installed', () => {
    expect(resolveCloudflareHostingTarget('static-assets', '')).toBe('pages-legacy');
    // Half-equipped is not equipped: both are read, and both throw when absent.
    expect(resolveCloudflareHostingTarget('static-assets', '', { hasWranglerBinary: true, hasWranglerConfig: false })).toBe('pages-legacy');
    expect(resolveCloudflareHostingTarget('static-assets', '', { hasWranglerBinary: false, hasWranglerConfig: true })).toBe('pages-legacy');
  });

  // The operator can still pin Pages; they can no longer force a Worker
  // deployment the project is incapable of performing.
  it('keeps Pages available as an explicit choice', () => {
    expect(resolveCloudflareHostingTarget('static-assets', 'cloudflare-pages')).toBe('pages-legacy');
    expect(resolveCloudflareHostingTarget('static-assets', 'cloudflare-pages', { hasWranglerBinary: true, hasWranglerConfig: true })).toBe('pages-legacy');
  });

  it('does not invent an invalid workers.dev hostname', () => {
    expect(workersDevUrl('coden-demo', '')).toBe('');
    expect(workersDevUrl('coden-demo', 'account-name')).toBe('https://coden-demo.account-name.workers.dev');
  });
});

describe('Published project hostname', () => {
  it('falls back to the Coden apex when no root domain is configured', () => {
    expect(codenRootDomain('')).toBe('coden.fun');
    expect(codenRootDomain(undefined)).toBe('coden.fun');
    expect(codenHostForSlug('my-app', '')).toBe('my-app.coden.fun');
  });

  it('serves every project from a self-hosted root domain', () => {
    expect(codenHostForSlug('my-app', 'example.com')).toBe('my-app.example.com');
  });

  it('normalizes a root domain pasted as a URL', () => {
    expect(codenRootDomain('https://Example.com/')).toBe('example.com');
    expect(codenHostForSlug('my-app', 'https://Example.com/')).toBe('my-app.example.com');
  });

  it('produces a DNS-safe label from an arbitrary slug', () => {
    expect(codenSubdomainForSlug('My Cool App!')).toBe('my-cool-app');
    expect(codenSubdomainForSlug('--weird--')).toBe('weird');
    expect(codenSubdomainForSlug('')).toBe('app');
    expect(codenHostForSlug('My Cool App!', 'example.com')).toBe('my-cool-app.example.com');
  });
});
