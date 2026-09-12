import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const builderHtml = readFileSync(resolve(process.cwd(), 'builder.html'), 'utf8');

describe('minimal builder shell', () => {
  it('keeps the top bar focused on preview and publishing', () => {
    expect(builderHtml).toContain('id="project-combo-trigger"');
    expect(builderHtml).toContain('class="btn-publish"');
    expect(builderHtml).not.toContain('id="tab-btn-more"');
    expect(builderHtml).not.toContain('id="builder-more-menu"');
    expect(builderHtml).not.toContain('aria-label="Options du projet"');
  });

  /*
   * This rule used to forbid any credit affordance here at all: an earlier
   * design put THREE in this popover — a credit status line, a free-credits
   * promo and an upgrade button — and the cure was to ban the lot.
   *
   * The owner has since asked for the balance and a way to upgrade back in
   * this panel. The intent worth keeping is the one that motivated the ban —
   * the popover does not become a dashboard — so the rule is now a budget
   * rather than a prohibition: navigation, renaming, and ONE credit
   * affordance. The promo and the second status line stay out.
   */
  it('limits the project popover to navigation, renaming and one credit affordance', () => {
    expect(builderHtml).toContain('id="project-menu-dashboard"');
    expect(builderHtml).toContain('id="project-name-edit"');
    expect(builderHtml).toContain('id="project-name-editor" hidden');

    // The one affordance: a balance, and the action it leads to.
    expect(builderHtml).toContain('id="project-menu-credits-value"');
    expect(builderHtml).toContain('id="project-menu-upgrade"');

    // The sprawl that caused the original ban stays gone.
    expect(builderHtml).not.toContain('id="project-menu-credit-status"');
    expect(builderHtml).not.toContain('id="project-menu-free-credits"');

    // And exactly one upgrade control, so it cannot quietly become two again.
    expect(builderHtml.match(/id="project-menu-upgrade"/g)).toHaveLength(1);
  });
});
