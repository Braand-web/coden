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

  it('limits the project popover to navigation and renaming', () => {
    expect(builderHtml).toContain('id="project-menu-dashboard"');
    expect(builderHtml).toContain('id="project-name-edit"');
    expect(builderHtml).toContain('id="project-name-editor" hidden');
    expect(builderHtml).not.toContain('id="project-menu-credit-status"');
    expect(builderHtml).not.toContain('id="project-menu-upgrade"');
    expect(builderHtml).not.toContain('id="project-menu-free-credits"');
  });
});
