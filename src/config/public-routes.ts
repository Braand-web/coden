/**
 * Where the public navigation points, decided once.
 *
 * The same menu was written out in three places — the landing's markup, the
 * React header, and the footer the SEO generator injects into every page on
 * every build — and they disagreed. Following "Tarifs" out of the home page
 * arrived at a header offering a different site, because it was a different
 * menu.
 *
 * The destinations live in `config/public-route-policy.json`, which already
 * held the canonical routes and the redirects and is already read by the
 * server, the Vite config, the SEO generator and its checker. Extending the
 * file everything already consults beats introducing a fourth opinion: the
 * generator is CommonJS and cannot import TypeScript, so JSON is the only
 * shape all of them can read.
 *
 * This module is the typed view of it for the app. It adds no destinations of
 * its own — if a link is not in the policy, it does not exist.
 */

import policy from '../../config/public-route-policy.json';

export type PublicLocale = 'fr' | 'en';

export type PublicNavLink = {
  label: Record<PublicLocale, string>;
  href: string;
};

export const PUBLIC_NAV: readonly PublicNavLink[] = policy.nav.primary;
export const PUBLIC_LEGAL_LINKS: readonly PublicNavLink[] = policy.nav.legal;
export const PUBLIC_ACTIONS: { signIn: PublicNavLink; cta: PublicNavLink } = policy.nav.actions;

/** The one pricing page. Everything that links to pricing reads this. */
export const PRICING_ROUTE = policy.nav.primary.find(link => link.href.includes('pricing'))?.href || '/pricing.html';

export function navLabel(link: PublicNavLink, locale: PublicLocale): string {
  return link.label[locale] || link.label.fr;
}
