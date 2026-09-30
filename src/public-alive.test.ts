import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('the landing page keeps its two composers', () => {
  const html = read('index.html');

  it('has the hero composer and the closing composer, each with its own status line', () => {
    expect(html.match(/class="lp-composer-host"/g)).toHaveLength(2);
    for (const id of ['landing-composer', 'landing-final-composer', 'landing-composer-status', 'landing-final-composer-status']) expect(html).toContain(`id="${id}"`);
  });

  it('mounts both, and shares one draft between them', () => {
    const script = read('src/landing-new.ts');
    expect(script).toMatch(/\['landing-composer', 'landing-composer-status'\]/);
    expect(script).toMatch(/\['landing-final-composer', 'landing-final-composer-status'\]/);
    expect(script.match(/createLandingDraft\(/g)).toHaveLength(1);
  });

  it('keeps its headline, its plans and its FAQ', () => {
    expect(html).toContain('Votre idée.');
    for (const plan of ['free', 'pro', 'business']) expect(html).toContain(`data-lp-plan="${plan}"`);
    expect(html).toContain('id="faq-title"');
  });
});

describe('the living layer of the public pages takes its colours from the tokens, and there is no violet', () => {
  for (const file of ['src/styles/public-alive.css']) {
    it(`${file} has no raw colour, no violet, and not the theme's indigo « cyan »`, () => {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css).not.toMatch(/violet|purple|indigo|syntax-cyan|syntax-blue|syntax-purple/i);
    });
  }

  it('respects reduced motion', () => {
    expect(read('src/styles/public-alive.css')).toMatch(/prefers-reduced-motion: reduce/);
  });
});
