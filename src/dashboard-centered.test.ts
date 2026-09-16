import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'dashboard.html'), 'utf8');
const reactDashboard = readFileSync(resolve(root, 'src/dashboard-react.tsx'), 'utf8');
const css = readFileSync(resolve(root, 'src/styles/dashboard-react.css'), 'utf8');
const server = readFileSync(resolve(root, 'server.ts'), 'utf8');
const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');
const promptInput = readFileSync(resolve(root, 'src/components/ui/ai-chat-input.tsx'), 'utf8');

describe('Coden projects dashboard surface contract', () => {
  it('mounts one React Dashboard and removes the legacy document UI', () => {
    expect((reactDashboard.match(/^\s*<h1\b/gm) || []).length).toBe(1);
    expect(html).toContain('id="coden-dashboard-react-root"');
    expect(html).toContain('src="/src/dashboard-react.tsx"');
    expect(html).not.toContain('coden-dashboard-legacy-runtime');
    expect(html).not.toContain('dashboard-live.ts');
    expect(html).not.toContain('dashboard-i18n.ts');
    expect(html).not.toContain('dashboard-welcome');
    expect(html).not.toContain('Start from an idea');
  });

  it('keeps one consistent Coden brand and accessible project controls', () => {
    expect(html).toContain('href="/favicon.svg"');
    expect(reactDashboard).toContain('src="/favicon.svg"');
    expect(reactDashboard).toContain('Mes projets');
    expect(reactDashboard).toContain('Nouveau projet');
    expect(reactDashboard).toContain('Rechercher un projet');
    expect(reactDashboard).toContain('Que voulez-vous créer');
    /*
     * The composer is labelled, and the label moved with it.
     *
     * This used to pin the old textarea's own aria-label. The field belongs to
     * the shared PromptInput now, which carries `aria-label="Prompt"`; what has
     * to stay true is that the composer is reachable by name and still invites
     * the same thing, not the exact string the previous markup used.
     */
    expect(reactDashboard).toContain('<PromptInput');
    expect(reactDashboard).toContain('Créez un CRM moderne');
    expect(reactDashboard).toContain('Récemment vus');
    expect(reactDashboard).toContain('Tout parcourir');
    expect(reactDashboard).toContain('preview_html');
    expect(reactDashboard).toContain('sandbox="allow-scripts"');
    expect(reactDashboard).toContain('data-coden-preview-error');
    /*
     * Attaching and dictating are the composer's own affordances now.
     *
     * They used to be two buttons in this file wired by prompt-input-actions;
     * the shared PromptInput brings both, so the assertion follows them rather
     * than declaring the feature gone. Checked in the component, because that
     * is where they would have to be removed from to actually disappear.
     */
    expect(promptInput).toContain('data-prompt-action="upload"');
    expect(promptInput).toContain('startRecording');
    expect(promptInput).toContain('<MicIcon />');
    // The dashboard mounts the shared composer rather than wiring loose
    // buttons through `initPromptInputActions`, which it no longer needs.
    expect(reactDashboard).toContain("from './components/ui/ai-chat-input'");
    expect(server).toContain('preview_html: project.preview_html || \'\'');
    expect(reactDashboard).not.toContain('Que veux-tu accomplir');
    expect(reactDashboard).not.toContain('Demander à Coden');
    expect(reactDashboard).not.toContain('Crédits');
    expect(reactDashboard).not.toContain('Modèles');
    expect(reactDashboard).toContain('aria-label="Fermer le menu"');
    expect(reactDashboard).toContain('Rétracter la barre latérale');
    expect(reactDashboard).toContain('is-collapsed');
    expect(css).toContain('.coden-dashboard-sidebar');
    expect(css).toContain('.coden-dashboard-project-list');
    expect(css).toContain('.coden-dashboard-project-card');
    expect(css).toContain('grid-template-columns: repeat(3');
    expect(css).toContain('--dashboard-sidebar-width: 228px');
    expect(css).toContain('width: 64px');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('uses TanStack Router and React Query with the real project endpoints', () => {
    expect(reactDashboard).toContain('@tanstack/react-router');
    expect(reactDashboard).toContain('@tanstack/react-query');
    expect(reactDashboard).toContain('QueryClientProvider');
    expect(reactDashboard).toContain('RouterProvider');
    expect(reactDashboard).toContain("basepath: '/dashboard.html'");
    expect(reactDashboard).toContain("apiFetch<ProjectsResponse>('/api/projects')");
    expect(reactDashboard).toContain("queryKey: ['coden-profile']");
    expect(reactDashboard).toContain("queryKey: ['coden-projects']");
  });

  it('keeps creation and opening as explicit Builder handoffs', () => {
    expect(reactDashboard).toContain("'/builder.html?new=1&source=dashboard'");
    expect(reactDashboard).toContain('project=\${encodeURIComponent(projectId)}&source=dashboard');
    expect(reactDashboard).toContain('startCreateProjectFlow');
    /*
     * Creation still names its mode, its model and its effort.
     *
     * The Auto/Plan toggle was the composer's only run-shaping control; the
     * PromptInput carries a model selector and an effort level instead, and
     * both have to reach `startCreateProjectFlow` or the choice the user made
     * is discarded at the door.
     */
    expect(reactDashboard).toContain("mode: 'auto'");
    expect(reactDashboard).toContain('model: meta.model');
    expect(reactDashboard).toContain('effort: meta.effort');
    expect(reactDashboard).toContain("openSettings('profile')");
    expect(reactDashboard).toContain('data-auth-logout');
    expect(reactDashboard).toContain("localStorage.setItem('coden-dashboard-sidebar-collapsed'");
  });

  it('keeps the real Builder handoff and the private page policy', () => {
    expect(reactDashboard).toContain("/builder.html?new=1");
    expect(html).toContain('noindex, nofollow');
    expect(html).toContain('data-coden-surface="dashboard"');
  });

  it('cannot serve the landing page when a Dashboard document has a trailing slash', () => {
    expect(viteConfig).toContain('coden-html-file-slash-normalization');
    expect(viteConfig).toContain('req.url = `${match[1]}${match[2] || \'\'}`');
    expect(server).toContain('/dashboard.html/?localPreview=1');
    expect(server).toContain('res.redirect(308, `${match[1]}${query}`)');
  });
});
