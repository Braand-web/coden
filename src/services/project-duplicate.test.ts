import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canDuplicateProject, duplicateProjectName } from './project-duplicate';

describe('the name of a copy', () => {
  it('adds « (copie) », then numbers further copies', () => {
    expect(duplicateProjectName('Site vitrine', [])).toBe('Site vitrine (copie)');
    expect(duplicateProjectName('Site vitrine', ['Site vitrine (copie)'])).toBe('Site vitrine (copie 2)');
    expect(duplicateProjectName('Site vitrine', ['Site vitrine (copie)', 'Site vitrine (copie 2)'])).toBe('Site vitrine (copie 3)');
  });

  it('does not stack suffixes when a copy is copied', () => {
    expect(duplicateProjectName('Site vitrine (copie)', ['Site vitrine (copie)'])).toBe('Site vitrine (copie 2)');
    expect(duplicateProjectName('Site vitrine (copie 2)', [])).toBe('Site vitrine (copie)');
  });

  it('ignores case in what is taken, survives an empty name, and stays short', () => {
    expect(duplicateProjectName('Site', ['SITE (COPIE)'])).toBe('Site (copie 2)');
    expect(duplicateProjectName('', [])).toBe('Projet (copie)');
    expect(duplicateProjectName('x'.repeat(300), []).length).toBeLessThanOrEqual(120);
  });
});

describe('who may duplicate', () => {
  it('owners, admins and editors — not viewers, not strangers', () => {
    expect(['owner', 'admin', 'editor'].map(canDuplicateProject)).toEqual([true, true, true]);
    expect(canDuplicateProject('viewer')).toBe(false);
    expect(canDuplicateProject(null)).toBe(false);
    expect(canDuplicateProject(undefined)).toBe(false);
  });
});

describe('the route', () => {
  const server = readFileSync('server.ts', 'utf8');
  const route = server.slice(server.indexOf("app.post('/api/projects/:id/duplicate'"), server.indexOf("app.get('/api/projects/:id/state'")).replace(/\/\*[\s\S]*?\*\//g, '');

  it('needs a signed-in user, limits itself, and checks the role before copying anything', () => {
    expect(route).toMatch(/requireAuthenticatedUser\(req, res\)/);
    expect(route).toMatch(/enforceRateLimit\(`project-duplicate:/);
    expect(route.indexOf('canDuplicateProject(')).toBeGreaterThan(-1);
    expect(route.indexOf('canDuplicateProject(')).toBeLessThan(route.indexOf('saveProject('));
  });

  it('builds the copy from named fields: nothing of the published site or the backend comes along', () => {
    expect(route).not.toMatch(/\.\.\.source\b/);
    expect(route).not.toMatch(/live_url|publish_status|custom_domain|project_secrets|backend_env/i);
    expect(route).toMatch(/status: 'draft'/);
  });
});

describe('the dashboard button', () => {
  const source = readFileSync('src/dashboard-react.tsx', 'utf8');
  const css = readFileSync('src/styles/dashboard-react.css', 'utf8');

  it('is a real button, labelled with the project, outside the card link, calling the route', () => {
    expect(source).toMatch(/aria-label=\{`Dupliquer le projet \$\{project\.name\}`\}/);
    expect(source).toMatch(/\/api\/projects\/\$\{encodeURIComponent\(project\.id\)\}\/duplicate/);
    const card = source.slice(source.indexOf('function ProjectCard'), source.indexOf('function ProjectCardSkeleton'));
    expect(card.indexOf('</a>')).toBeLessThan(card.indexOf('coden-dashboard-project-copy'));
  });

  it('shows on hover or focus with a pointer, and always on touch, with a larger target', () => {
    expect(css).toMatch(/\(hover: hover\) and \(pointer: fine\)[\s\S]*?coden-dashboard-project-copy \{ opacity: 0; \}/);
    expect(css).toMatch(/\(pointer: coarse\) \{ \.coden-dashboard-project-copy \{ width: 40px/);
  });
});
