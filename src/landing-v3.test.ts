import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { PUBLIC_PRICING_PLANS } from './config/pricing-plans';

const html = readFileSync('index.html', 'utf8');
const entry = readFileSync('src/landing-v3.ts', 'utf8');
describe('Landing v3 integration', () => {
  it('replaces the old homepage runtime without shipping DC directives', () => {
    expect(html).toContain('/src/landing-v3.ts');
    expect(html).not.toMatch(/support\.js|text\/x-dc|<\/?(?:x-dc|sc-if|sc-for)|\{\{|style-hover|\/src\/main\.ts|\/src\/index\.css/);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html.match(/<main\b/g)).toHaveLength(1);
  });
  it('keeps public links and in-page anchors resolvable', () => {
    for (const [,href] of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
      if (href.startsWith('#')) expect(html).toContain(`id="${href.slice(1)}"`);
      else if (href.startsWith('/')) expect(existsSync(href.split('?')[0].slice(1))).toBe(true);
    }
  });
  it('uses actual public prices and plan-aware checkout handoff', () => {
    for (const key of ['pro','scale'] as const) {
      expect(html).toContain(`data-plan-price="${key}">$${PUBLIC_PRICING_PLANS[key].monthly}`);
      expect(html).toContain(`data-plan-cta="${key}"`);
    }
    expect(entry).toContain('getPublicPlan(');
    expect(entry).toContain('plan.annual');
    expect(entry).toContain('&billing=${billing}');
  });
  it('connects both composers to the existing authenticated project flow', () => {
    expect(html.match(/data-build\b/g)).toHaveLength(2);
    expect(html.match(/data-prompt-action="upload"/g)).toHaveLength(2);
    expect(entry).toContain('startCreateProjectFlow');
    expect(entry).toContain('if (submitting) return');
    expect(entry).toContain('event.isComposing');
    expect(entry).toContain('persistForBuilder:true');
  });
  it('supports native keyboard-accessible FAQ and reduced motion', () => {
    expect(html.match(/<details class="cdn-faq"/g)).toHaveLength(5);
    expect(html).toContain('aria-live="polite"');
    expect(readFileSync('src/styles/landing-v3.css','utf8')).toContain('prefers-reduced-motion:reduce');
  });
});
