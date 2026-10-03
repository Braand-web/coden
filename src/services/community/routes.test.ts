import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CommunityStore, ANONYMOUS_CREATOR } from './store';

const routes = readFileSync(new URL('./routes.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const server = readFileSync(new URL('../../../server.ts', import.meta.url), 'utf8');

describe('who may call the Community routes', () => {
  it('only the thumbnail and the shareable page are public; everything else sits behind sign-in', () => {
    const authLine = routes.indexOf("app.use('/api/community', deps.requireAuth)");
    expect(authLine).toBeGreaterThan(0);
    const before = routes.slice(0, authLine);
    const after = routes.slice(authLine);
    expect([...before.matchAll(/app\.(?:get|post|put|patch|delete)\('([^']+)'/g)].map(match => match[1])).toEqual(['/api/community/listings/:id/thumbnail', '/c/:id']);
    // After the sign-in wall, every user route goes through the wrapper that authenticates and rate-limits.
    const userRoutes = [...after.matchAll(/app\.(get|post|put|patch|delete)\('(\/api\/community[^']*)', (handler\([^)]*\)|async)/g)];
    expect(userRoutes.length).toBeGreaterThan(15);
    for (const [, , path, how] of userRoutes) expect(how, path).toContain('handler(');
  });

  it('every admin route checks the platform admin role and limits mutations', () => {
    const admin = [...routes.matchAll(/app\.(get|post)\('(\/api\/admin\/community[^']*)', async \(req: any, res: any\) => \{\n\s+try \{\n\s+if \(([^\n]+)\) return;/g)];
    expect(admin.length).toBe(5);
    for (const [, method, path, guard] of admin) {
      expect(guard, path).toContain('requirePlatformAdmin(req, res)');
      if (method === 'post') expect(guard, path).toContain('adminMutationAllowed');
    }
  });

  it('is wired in server.ts behind the plan and publication hooks, and the flag is off by default', () => {
    expect(server).toContain('registerCommunityRoutes({');
    expect(server).toContain('communityService.onPublished(');
    expect(server).toContain('communityService.onUnpublished(');
    expect(server).toContain('communityService.onProjectDeleted(');
    expect(server).toContain('setPlanChangeHook(');
    const rules = readFileSync(new URL('./rules.ts', import.meta.url), 'utf8');
    expect(rules).toContain("enabled: truthy(env.CODEN_COMMUNITY)");
  });
});

/** A client that answers every query with the rows it was given and remembers what was selected. */
function fakeClient(tables: Record<string, any[]>) {
  const selects: Array<{ table: string; columns: string }> = [];
  const builder = (table: string, columns = '*') => {
    const chain: any = { then: (resolve: any) => resolve({ data: tables[table] || [], error: null }) };
    for (const method of ['eq', 'neq', 'in', 'or', 'not', 'order', 'limit', 'gte', 'lte', 'is']) chain[method] = () => chain;
    chain.maybeSingle = async () => ({ data: (tables[table] || [])[0] || null, error: null });
    return chain;
  };
  return { selects, from: (table: string) => ({ select: (columns: string) => { selects.push({ table, columns }); return builder(table, columns); } }) };
}

describe('what a visitor can see of a listing', () => {
  const row = { id: '11111111-1111-4111-8111-111111111111', owner_id: 'secret-owner-id', title: 'Atelier', description: 'Un site', category: 'portfolio', tags: [], creator_alias: null, remixable: true, thumbnail_path: 'x/y.webp', thumbnail_alt: null, quality_score: 80, featured: false, like_count: 2, remix_count: 1, listed_at: '2026-10-01T00:00:00Z', discover_rank: 1, trending_score: 0, thumbnail_version: '2026-10-01T00:00:00Z' };

  it('never carries the owner, the project, the source or any e-mail, and shows « Créateur anonyme » without a chosen name', async () => {
    const client = fakeClient({ community_listings: [row], community_profiles: [], community_likes: [] });
    const page = await new CommunityStore(client).list({ tab: 'recent', viewer: 'someone-else' });
    const text = JSON.stringify(page);
    expect(text).not.toContain('secret-owner-id');
    expect(text).not.toMatch(/owner|project_id|files|email|@/i);
    expect(page.items[0].creator).toBe(ANONYMOUS_CREATOR);
    // The columns asked of the database exclude everything private as well.
    const asked = client.selects.find(select => select.table === 'community_listings')!.columns;
    expect(asked).not.toMatch(/project_id|files|current_version_id|status_reason|content_fingerprint/);
  });

  it('shows the pseudonym the creator chose, or a public profile name, in that order', async () => {
    const chosen = await new CommunityStore(fakeClient({ community_listings: [{ ...row, creator_alias: 'Lina' }], community_profiles: [{ user_id: 'secret-owner-id', display_name: 'Lina Kamga', public: true }], community_likes: [] })).list({ tab: 'recent' });
    expect(chosen.items[0].creator).toBe('Lina');
    const profile = await new CommunityStore(fakeClient({ community_listings: [row], community_profiles: [{ user_id: 'secret-owner-id', display_name: 'Lina Kamga', public: true }], community_likes: [] })).list({ tab: 'recent' });
    expect(profile.items[0].creator).toBe('Lina Kamga');
    expect(profile.items[0].creatorProfile).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(profile)).not.toContain('secret-owner-id');
  });
});
