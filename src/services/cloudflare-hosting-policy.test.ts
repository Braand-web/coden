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

  it('uses Workers Static Assets by default for static apps', () => {
    expect(resolveCloudflareHostingTarget('static-assets', '')).toBe('workers-static-assets');
    expect(hostingProviderForTarget('workers-static-assets')).toBe('cloudflare-workers');
  });

  it('keeps Pages only as an explicit legacy option', () => {
    expect(resolveCloudflareHostingTarget('static-assets', 'cloudflare-pages')).toBe('pages-legacy');
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
