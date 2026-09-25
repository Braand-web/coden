import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every admin route answers platform admins only. The learning and
 * integration routes added to the console are held to the same rule as the
 * rest, and never return a user's instructions or a contributor hash.
 */
describe('admin routes', () => {
  const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const routes = [...server.matchAll(/app\.(get|post|patch|put|delete)\('(\/api\/admin\/[^']+)'[^\n]*\n([^\n]*)/g)];

  it('all check the platform admin role first', () => {
    expect(routes.length).toBeGreaterThan(10);
    for (const [, , path, firstLine] of routes) expect(firstLine, path).toContain('requirePlatformAdmin(req, res)');
    expect(routes.map(([, , path]) => path)).toEqual(expect.arrayContaining(['/api/admin/agent-learning', '/api/admin/integrations']));
  });

  it('report counts and anonymised patterns, not private content', () => {
    const learning = server.slice(server.indexOf("app.get('/api/admin/agent-learning'"), server.indexOf("app.get('/api/admin/integrations'"));
    const response = learning.slice(learning.indexOf('res.json({'));
    expect(response).not.toMatch(/[\s{,]instructions:/);
    expect(response).not.toMatch(/contributor[^s]/);
    expect(response).toContain('with_instructions');
  });
});
