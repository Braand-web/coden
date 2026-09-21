import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The composer does not draw a rectangle around the text being typed.
 *
 * Five stylesheets declare the same global
 * `:where(button, a, input, textarea, select, summary):focus-visible`, one of
 * them with `!important`, so every composer drew a hard 2px accent rectangle
 * the moment anyone typed — square corners on a 24px-rounded card, which is
 * why it read as a browser default rather than as a design.
 *
 * Read from the source rather than from a render, because the fault was never
 * in the markup: the component already carried Tailwind's `outline-none`,
 * which in v3 paints a *transparent* outline instead of removing one, so the
 * global rule only had to repaint its colour.
 */
const css = readFileSync(new URL('../../styles/coden-composer.css', import.meta.url), 'utf8');
const component = readFileSync(new URL('./ai-chat-input.tsx', import.meta.url), 'utf8');

/** Selectors whose rule removes the ring outright, comments stripped. */
const ringRemovals = [...css.replace(/\/\*[\s\S]*?\*\//g, '')
  .matchAll(/([^{}]+)\{[^}]*outline:\s*none\s*!important/g)]
  .flatMap(match => match[1].split(',').map(part => part.trim()).filter(Boolean));

describe('composer focus ring', () => {
  it('hangs off classes the component actually renders', () => {
    expect(component).toContain('coden-prompt-card');
    expect(component).toContain('coden-prompt-placeholder');
  });

  it('is removed from the field, in a way that beats an !important global', () => {
    const rule = css.split('}').find(block => block.includes('.coden-prompt-card > textarea:focus-visible')) ?? '';
    expect(rule).toMatch(/outline:\s*none\s*!important/);
    expect(rule).toMatch(/box-shadow:\s*none\s*!important/);
  });

  /*
   * A folded composer is the same field wearing a button: it carries the
   * placeholder and `cursor-text`, and expands into the textarea on click.
   * Covering only the expanded one would put the rectangle back for anyone
   * starting from a folded composer — which is every composer that does not
   * open expanded.
   */
  it('covers the folded composer and the clarification field as well', () => {
    expect(ringRemovals).toContain('.coden-prompt-placeholder:focus-visible');
    expect(ringRemovals).toContain('.coden-clarification-answer:focus-visible');
  });

  /*
   * A focused text field already shows a caret, and the card lights its border
   * through `focus-within`. A model picker or a send button shows nothing at
   * all, so the ring is removed from the field only — never from the controls
   * beside it, which a keyboard user has to be able to find.
   */
  it('leaves every other control its ring', () => {
    expect(ringRemovals.length).toBeGreaterThan(0);
    for (const selector of ringRemovals) {
      expect(selector).toMatch(/textarea|prompt-placeholder|clarification-answer/);
    }
  });
});
