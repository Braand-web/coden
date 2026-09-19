import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRICING_ROUTE, PUBLIC_ACTIONS, PUBLIC_LEGAL_LINKS, PUBLIC_NAV, navLabel } from './public-routes';
import policy from '../../config/public-route-policy.json';

/**
 * One public navigation, and nothing allowed to restate it.
 *
 * The menu used to be written out in three places — the landing's markup, the
 * React header, and the footer the SEO generator injects on every build — and
 * they disagreed, so following a link out of the home page arrived at what
 * looked like an older product. These tests fail if any of the three starts
 * carrying its own opinion again.
 */
const root = new URL('../../', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), 'utf8');
const publicPages = readdirSync(new URL('.', root))
  .filter(name => /\.html$/.test(name))
  .filter(name => !/^(auth|dashboard|builder|admin|checkout)\.html$/.test(name));

describe('the public navigation', () => {
  it('is the one the policy defines, and the policy is what the app reads', () => {
    expect(PUBLIC_NAV.map(link => link.href)).toEqual(policy.nav.primary.map(link => link.href));
    expect(PUBLIC_NAV.length).toBeGreaterThan(0);
  });

  it('never sends anyone through a redirect', () => {
    // A redirect exists for old external links. An internal button reaching
    // one means the button is wrong, and the redirect is hiding it.
    const redirected = Object.keys(policy.redirects);
    for (const link of [...PUBLIC_NAV, ...PUBLIC_LEGAL_LINKS, PUBLIC_ACTIONS.signIn, PUBLIC_ACTIONS.cta]) {
      const path = link.href.split(/[?#]/)[0];
      expect(redirected, `${link.href} is an internal link pointing at a redirect`).not.toContain(path);
    }
  });

  it('points at routes the policy considers real', () => {
    for (const link of PUBLIC_NAV) {
      const path = link.href.split('#')[0] || '/';
      expect([...policy.canonicalPublic, '/'], `${link.href} is not a canonical public route`).toContain(path);
    }
  });

  it('has exactly one pricing destination', () => {
    expect(PUBLIC_NAV.filter(link => /pricing|tarif/i.test(link.href))).toHaveLength(1);
    expect(PRICING_ROUTE).toBe('/pricing.html');
  });
});

describe('the pages that are actually served', () => {
  /*
   * Features and Documentation were dropped from the primary menu. They still
   * exist as indexed pages, so the test is not that the files are gone — it is
   * that no public page links into them as if they were part of the menu,
   * which is what made two navigations visible at once.
   */
  it('carry no link to a page the menu no longer offers', () => {
    const offered = new Set(PUBLIC_NAV.map(link => link.href.split('#')[0]).filter(Boolean));
    for (const page of publicPages) {
      const html = read(page);
      for (const dropped of ['/features.html', '/documentation.html']) {
        if (offered.has(dropped)) continue;
        expect(html, `${page} still links to ${dropped}`).not.toContain(`href="${dropped}"`);
      }
    }
  });

  it('carry no second static navigation for React to delete at runtime', () => {
    // These were kept "for migration safety" and the React mount removes them,
    // so they were invisible to a person and visible to a crawler.
    for (const page of publicPages) {
      expect(read(page), `${page} still has a legacy static nav`).not.toMatch(/<nav class="(navbar|topbar)"/);
    }
  });
});

describe('the SEO generator', () => {
  const generator = read('scripts/generate-seo-assets.cjs');

  /*
   * `prebuild` runs this on every build and it rewrites each page's footer, so
   * a menu typed in here outlives any correction made in the HTML. That is
   * precisely how the old navigation kept coming back.
   */
  it('reads the policy instead of listing destinations of its own', () => {
    const footer = generator.slice(generator.indexOf('function sharedPublicFooter'));
    const body = footer.slice(0, footer.indexOf('\n}'));
    expect(body).toContain('routePolicy.nav');
    for (const dropped of ['/features.html', '/documentation.html']) {
      expect(body, `the generator would re-inject ${dropped}`).not.toContain(dropped);
    }
  });
});
