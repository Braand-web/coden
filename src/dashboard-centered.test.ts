import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'dashboard.html'), 'utf8');
const css = readFileSync(resolve(root, 'src/styles/dashboard-workspace.css'), 'utf8');
const live = readFileSync(resolve(root, 'src/dashboard-live.ts'), 'utf8');
const server = readFileSync(resolve(root, 'server.ts'), 'utf8');

describe('centered Coden dashboard contract', () => {
  it('keeps one centered product heading and removes the legacy welcome copy', () => {
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).toContain('id="coden-dashboard-title">CODEN</h1>');
    expect(html).not.toContain('dashboard-welcome');
    expect(html).not.toContain('Build what matters next.');
    expect(html).not.toContain('Start with an idea');
  });

  it('integrates plan, project and composer context without fake wallet values', () => {
    expect(html).toContain('id="btn-upgrade-dashboard"');
    expect(html).toContain('id="dashboard-project-select"');
    expect(html).toContain('id="ai-textarea"');
    expect(html).not.toMatch(/class="credits-count">\d/);
    expect(css).toContain('max-width:640px');
    expect(css).toContain('width:min(100%,640px)');
  });

  it('sends project and attachment context through the real assistant APIs', () => {
    expect(live).toContain('projectId: selectedDashboardProjectId() || undefined');
    expect(live).toContain('attachmentIds: dashboardAttachments');
    expect(server).toContain("app.post('/api/assistant/attachments'");
    expect(server).toContain("app.delete('/api/assistant/attachments/:attachmentId'");
    expect(server).toContain('resolveAssistantAttachments(userId, req.body?.attachmentIds)');
  });
});

