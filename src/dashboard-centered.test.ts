import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'dashboard.html'), 'utf8');
const css = [
  readFileSync(resolve(root, 'src/styles/dashboard-kimi.css'), 'utf8'),
  readFileSync(resolve(root, 'src/styles/dashboard-kimi-sidebar.css'), 'utf8'),
  readFileSync(resolve(root, 'src/styles/dashboard-coden.css'), 'utf8'),
].join('\n');
const live = readFileSync(resolve(root, 'src/dashboard-live.ts'), 'utf8');
const server = readFileSync(resolve(root, 'server.ts'), 'utf8');

describe('restored Coden dashboard contract', () => {
  it('keeps the centered product heading and the legacy screenshot composition', () => {
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).toContain('class="topbar-title"');
    expect(html).toContain('id="btn-new-project"');
    expect(html).toContain('class="sidebar-credits"');
    expect(html).toContain('class="sidebar-promo"');
    expect(html).toContain('class="chips-row"');
    expect(html).toContain('All Projects');
    expect(html).not.toContain('dashboard-welcome');
    expect(html).not.toContain('Build what matters next.');
    expect(html).not.toContain('Start with an idea');
  });

  it('keeps the original sidebar plan and compact composer without fake wallet values', () => {
    expect(html).toContain('id="btn-upgrade-dashboard"');
    expect(html).not.toContain('class="dashboard-plan-pill');
    expect(html).not.toContain('id="dashboard-project-select"');
    expect(html).toContain('id="ai-textarea"');
    expect(html).not.toMatch(/class="credits-count">\d/);
    expect(css).toContain("content: 'CODEN'");
    expect(html).toContain('class="chips-row"');
    expect(css).toContain('.sidebar-promo');
  });

  it('sends project and attachment context through the real assistant APIs', () => {
    expect(live).toContain('projectId: selectedDashboardProjectId() || undefined');
    expect(live).toContain('attachmentIds: dashboardAttachments');
    expect(server).toContain("app.post('/api/assistant/attachments'");
    expect(server).toContain("app.delete('/api/assistant/attachments/:attachmentId'");
    expect(server).toContain('resolveAssistantAttachments(userId, req.body?.attachmentIds)');
  });
});
