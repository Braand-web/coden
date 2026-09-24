/**
 * The Coden mark, drawn in one place.
 *
 * Every surface used to draw its own: black on white in the favicon and the
 * admin, white on black in the dark dashboard, blue with a dark glyph on the
 * public pages, grey in the Builder, a different house in the onboarding.
 * The mark is a brand asset, not a themed control, so it does not flip with
 * the theme: the Coden blue tile with a white glyph, everywhere.
 *
 * The colours are the --brand / --on-brand tokens (coden-tokens.css), with
 * the same values as fallbacks so the SVG reads correctly even where no
 * stylesheet has loaded (favicons, e-mails, a page's first paint).
 */

export const CODEN_BRAND = '#3A83F7';
export const CODEN_ON_BRAND = '#FFFFFF';

export const CODEN_LOGO_GLYPH = [
  'M16 8L25 13.5V14.5L16 9.5L7 14.5V13.5L16 8Z',
  'M7 16.5V24.5L11.5 22V14L7 16.5Z',
  'M25 16.5V24.5L16 24.5V22H20.5V14L25 16.5Z',
] as const;

export const CODEN_LOGO_TILE_RADIUS = 8;

const TILE = `var(--brand, ${CODEN_BRAND})`;
const GLYPH = `var(--on-brand, ${CODEN_ON_BRAND})`;

/** The mark as markup, for surfaces that are not React. */
export function codenLogoSvg(options: { size?: number; className?: string } = {}): string {
  const size = options.size ?? 32;
  return `<svg class="coden-logo-mark${options.className ? ` ${options.className}` : ''}" data-coden-logo="mark" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">`
    + `<rect width="32" height="32" rx="${CODEN_LOGO_TILE_RADIUS}" fill="${TILE}"/>`
    + CODEN_LOGO_GLYPH.map(d => `<path d="${d}" fill="${GLYPH}"/>`).join('')
    + '</svg>';
}

export const CODEN_LOGO_TILE_FILL = TILE;
export const CODEN_LOGO_GLYPH_FILL = GLYPH;
