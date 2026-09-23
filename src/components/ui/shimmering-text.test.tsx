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

  it('is styled in one place only, so nothing later in the page can override it', () => {
    // The conversation island injected its own `.coden-shimmer-text` rule into
    // <head> after this stylesheet: `background: var(--surface)` clipped to
    // transparent glyphs painted every thinking label in the background colour.
    const island = readFileSync(new URL('../../builder-conversation-island.tsx', import.meta.url), 'utf8');
    expect(island).not.toMatch(/\.coden-shimmer-text\s*[,{]/);
    expect(island).not.toContain('coden-text-shimmer');
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

  /*
   * The loop has to travel a whole number of tiles, or it visibly jumps.
   *
   * The background repeats, so shifting it by exactly its own width lands on a
   * pattern identical to the one it started from. The first version travelled
   * 2.88 element-widths against a 2.2-wide tile — 1.31 tiles — and snapped back
   * every 2.1 seconds. This is arithmetic on the two numbers rather than a
   * screenshot, so it holds whoever next retunes the sweep.
   */
  it('slides by exactly one tile, so the restart is invisible', () => {
    const size = Number(css.match(/background-size:\s*([\d.]+)%/)?.[1]);
    const stops = [...css.matchAll(/background-position:\s*(-?[\d.]+)%/g)].map(match => Number(match[1]));
    expect(size).toBeGreaterThan(100);
    expect(stops.length).toBeGreaterThanOrEqual(2);

    const tiles = size / 100;
    // A percentage position moves the image by (tile - 1) element-widths per 100%.
    const travel = ((tiles - 1) * (Math.max(...stops) - Math.min(...stops))) / 100;
    expect(travel / tiles).toBeCloseTo(Math.round(travel / tiles), 5);
    expect(Math.round(travel / tiles)).toBeGreaterThanOrEqual(1);
  });

  /*
   * A narrow band on a wide tile leaves the text flat for most of the cycle,
   * which reads as frozen rather than as working. Measured across the loop,
   * the first shape was lit in 4 frames of 10.
   */
  it('keeps the highlight over the text rather than off to one side', () => {
    const size = Number(css.match(/background-size:\s*([\d.]+)%/)?.[1]);
    const gradient = css.match(/linear-gradient\(([\s\S]*?)\);/)?.[1] ?? '';
    const positions = [...gradient.matchAll(/([\d.]+)%/g)].map(match => Number(match[1]));
    // The lit part of the tile, as a fraction of the element, has to be wide
    // enough to still be on screen as it travels.
    const litSpan = (Math.max(...positions) - Math.min(...positions)) / 100;
    expect(litSpan * (size / 100)).toBeGreaterThanOrEqual(1);
  });

  it('leaves something legible when motion is reduced', () => {
    const reduced = ruleFor('prefers-reduced-motion');
    expect(reduced).toContain('animation: none');
    expect(ruleFor('coden-shimmer-text')).toMatch(/color:\s*var\(--text-secondary\)/);
  });
});
