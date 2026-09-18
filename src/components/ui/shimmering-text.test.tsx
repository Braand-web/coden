import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShimmeringText } from './shimmering-text';

/**
 * Transparent text must always have something painting it.
 *
 * The shimmer is text coloured by a moving background and clipped to the
 * glyphs. That means `color: transparent` is only survivable while the
 * background actually paints — and it did not: `background-image` was set to
 * `var(--surface)`, a flat colour, which is not an `<image>`, so it computed to
 * `none` and the label rendered as nothing at all.
 *
 * These read the stylesheet rather than the rendered pixels because the rule
 * is the invariant: whatever makes the text invisible has to be paired with
 * something that brings it back.
 */
const css = readFileSync(new URL('./shimmering-text.css', import.meta.url), 'utf8');

const ruleFor = (selector: string) => css
  .split('}')
  .filter(block => block.includes(selector))
  .join('\n');

describe('ShimmeringText', () => {
  it('renders the label as real text', () => {
    const html = renderToStaticMarkup(React.createElement(ShimmeringText, { text: 'Coden réfléchit…' }));
    expect(html).toContain('Coden réfléchit…');
    expect(html).toContain('coden-shimmer-text');
  });

  it('keeps a caller class alongside its own', () => {
    expect(renderToStaticMarkup(React.createElement(ShimmeringText, { text: 'x', className: 'mine' })))
      .toContain('class="coden-shimmer-text mine"');
  });

  it('paints the glyphs with a gradient, not a colour', () => {
    const declared = [...css.matchAll(/background-image:\s*([^;]+);/g)].map(match => match[1].trim());
    expect(declared.length).toBeGreaterThan(0);
    for (const value of declared) {
      // `none` is the reduced-motion fallback, which restores a solid colour.
      expect(value === 'none' || /^(linear|radial|conic|repeating-)/.test(value)).toBe(true);
    }
  });

  it('only makes the text transparent where the background can be clipped to it', () => {
    const transparentBlocks = css.split('@supports').slice(1);
    expect(css).toContain('color: transparent');
    // Every `color: transparent` sits inside an @supports that tests clipping.
    const outsideSupports = css.split('@supports')[0];
    expect(outsideSupports).not.toContain('color: transparent');
    expect(transparentBlocks.some(block => block.includes('background-clip: text') && block.includes('color: transparent'))).toBe(true);
  });

  it('leaves something legible when motion is reduced', () => {
    const reduced = ruleFor('prefers-reduced-motion');
    expect(reduced).toContain('animation: none');
    expect(ruleFor('coden-shimmer-text')).toMatch(/color:\s*var\(--text-secondary\)/);
  });
});
