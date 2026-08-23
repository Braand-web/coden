import { describe, expect, it } from 'vitest';
import {
  hostingProviderForTarget,
  resolveCloudflareHostingTarget,
  workersDevUrl,
} from './cloudflare-hosting-policy.ts';

describe('Cloudflare hosting policy', () => {
  it('never downgrades a full-stack manifest to Pages', () => {
    expect(resolveCloudflareHostingTarget('cloudflare-workers', 'cloudflare-pages')).toBe('workers-fullstack');
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
