import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'dashboard.html'), 'utf8');
const reactDashboard = readFileSync(resolve(root, 'src/dashboard-react.tsx'), 'utf8');
const css = readFileSync(resolve(root, 'src/styles/dashboard-react.css'), 'utf8');
const server = readFileSync(resolve(root, 'server.ts'), 'utf8');
const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');

describe('Coden Dashboard Orygin surface contract', () => {
  it('mounts one React Dashboard and removes the legacy document UI', () => {
    expect((reactDashboard.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).toContain('id="coden-dashboard-react-root"');
    expect(html).toContain('src="/src/dashboard-react.tsx"');
    expect(html).not.toContain('coden-dashboard-legacy-runtime');
    expect(html).not.toContain('dashboard-live.ts');
    expect(html).not.toContain('dashboard-i18n.ts');
    expect(html).not.toContain('dashboard-welcome');
    expect(html).not.toContain('Start from an idea');
  });

  it('keeps the Coden brand, Orygin composition and accessible controls', () => {
    expect(html).toContain('href="/favicon.svg"');
    expect(reactDashboard).toContain('src="/favicon.svg"');
    expect(reactDashboard).toContain('Nouvelle conversation');
    expect(reactDashboard).toContain('Que veux-tu accomplir');
    expect(reactDashboard).toContain('Demander à Coden');
    expect(reactDashboard).toContain('Nouveau chat');
    expect(reactDashboard).toContain('Coden Studio');
    expect(reactDashboard).not.toContain('label="Plugins"');
    expect(reactDashboard).not.toContain('className="coden-orygin-login"');
    expect(reactDashboard).toContain('aria-controls="coden-orygin-sidebar"');
    expect(reactDashboard).toContain('aria-label="Fermer le menu"');
    expect(reactDashboard).toContain('Rétracter la barre latérale');
    expect(reactDashboard).toContain('is-collapsed');
    expect(css).toContain('.coden-orygin-sidebar');
    expect(css).toContain('.coden-orygin-composer');
    expect(css).toContain('width: 248px');
    expect(css).toContain('width: 72px');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('uses TanStack Router and React Query without replacing real project creation', () => {
    expect(reactDashboard).toContain('@tanstack/react-router');
    expect(reactDashboard).toContain('@tanstack/react-query');
    expect(reactDashboard).toContain('QueryClientProvider');
    expect(reactDashboard).toContain('RouterProvider');
    expect(reactDashboard).toContain("basepath: '/dashboard.html'");
    expect(reactDashboard).toContain('startCreateProjectFlow');
    expect(reactDashboard).toContain("queryKey: ['coden-profile']");
  });

  it('keeps the prompt flow safe and prevents duplicate submissions', () => {
    expect(reactDashboard).toContain('if (!prompt || busy) return;');
    expect(reactDashboard).toContain("event.nativeEvent.isComposing");
    expect(reactDashboard).toContain("event.key === 'Enter' && !event.shiftKey");
    expect(reactDashboard).toContain("source: 'dashboard'");
    expect(reactDashboard).toContain('La génération est désactivée dans l’aperçu local.');
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
