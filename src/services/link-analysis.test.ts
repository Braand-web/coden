import { describe, expect, it } from 'vitest';
import { analyzeLink, isAllowedByRobots, LinkError, parsePreview, previewLink, robotsAllows, robotsRules } from './link-analysis';

const publicLookup = async () => [{ address: '93.184.216.34' }];
const response = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });

describe('link analysis', () => {
  it('reads robots.txt as RFC 9309 says', () => {
    const rules = robotsRules('User-agent: *\nDisallow: /admin\nAllow: /admin/public\nDisallow: /*.pdf$\n\nUser-agent: OtherBot\nDisallow: /');
    expect(robotsAllows(rules, '/')).toBe(true);
    expect(robotsAllows(rules, '/admin/users')).toBe(false);
    expect(robotsAllows(rules, '/admin/public/page')).toBe(true);
    expect(robotsAllows(rules, '/docs/guide.pdf')).toBe(false);
    expect(robotsAllows(rules, '/docs/guide.pdf?x=1')).toBe(true);
    // Coden's own group wins over `*`.
    const own = robotsRules('User-agent: *\nDisallow: /\n\nUser-agent: CodenBot\nAllow: /');
    expect(robotsAllows(own, '/pricing')).toBe(true);
    expect(robotsAllows(robotsRules('User-agent: *\nDisallow:'), '/anything')).toBe(true);
  });

  it('refuses a site whose robots.txt forbids the page', async () => {
    const fetchImpl = (async (input: any) => String(input).endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /', { headers: { 'content-type': 'text/plain' } }) : response('<html></html>')) as typeof fetch;
    expect(await isAllowedByRobots(new URL('https://robots-closed.example/page'), { lookup: publicLookup, fetchImpl })).toBe(false);
    await expect(analyzeLink('https://robots-closed.example/page', { lookup: publicLookup, fetchImpl })).rejects.toMatchObject({ code: 'robots' });
  });

  it('never reaches a private or metadata address, even through a redirect', async () => {
    for (const url of ['http://localhost:3000', 'http://127.0.0.1/', 'http://10.1.2.3/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://metadata.internal/']) {
      await expect(analyzeLink(url), url).rejects.toMatchObject({ code: 'private_address' });
    }
    const privateLookup = async () => [{ address: '10.0.0.5' }];
    await expect(previewLink('https://intranet.example/', { lookup: privateLookup })).rejects.toMatchObject({ code: 'private_address' });
    const redirecting = (async () => new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest' } })) as typeof fetch;
    await expect(previewLink('https://public.example/', { lookup: publicLookup, fetchImpl: redirecting })).rejects.toMatchObject({ code: 'private_address' });
  });

  it('builds a preview card from the page head', async () => {
    const html = '<html><head><title>Kawa &amp; Co</title><meta property="og:description" content="Café torréfié"><meta property="og:image" content="/og.jpg"><link rel="shortcut icon" href="/icon.png"></head></html>';
    const fetchImpl = (async () => response(html)) as typeof fetch;
    const preview = await previewLink('https://kawa.example/menu', { lookup: publicLookup, fetchImpl });
    expect(preview).toEqual({
      url: 'https://kawa.example/menu',
      finalUrl: 'https://kawa.example/menu',
      title: 'Kawa & Co',
      description: 'Café torréfié',
      siteName: 'kawa.example',
      favicon: 'https://kawa.example/icon.png',
      image: 'https://kawa.example/og.jpg',
    });
    expect(parsePreview('<html></html>', new URL('https://a.example/')).favicon).toBe('https://a.example/favicon.ico');
  });

  it('says so when a page wants a login or answers with an error', async () => {
    await expect(previewLink('https://app.example/', { lookup: publicLookup, fetchImpl: (async () => response('', { status: 401 })) as typeof fetch }))
      .rejects.toMatchObject({ code: 'login_required' });
    await expect(previewLink('https://app.example/', { lookup: publicLookup, fetchImpl: (async () => response('', { status: 500 })) as typeof fetch }))
      .rejects.toBeInstanceOf(LinkError);
  });
});
