import { describe, expect, it } from 'vitest';
import { createCommunityService } from './service';

/** A tiny in-memory database: just the tables and the calls the showcase installation makes. */
function fakeClient(initial: Record<string, any[]>) {
  const tables: Record<string, any[]> = JSON.parse(JSON.stringify(initial));
  const query = (table: string) => {
    let rows = tables[table] || (tables[table] = []);
    const filters: Array<(row: any) => boolean> = [];
    const chain: any = {
      select: () => chain, eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return chain; },
      order: () => chain, limit: () => chain, gte: () => chain, in: () => chain,
      maybeSingle: async () => ({ data: rows.filter(row => filters.every(test => test(row)))[0] || null, error: null }),
      then: (resolve: any) => resolve({ data: rows.filter(row => filters.every(test => test(row))), error: null }),
      insert: (value: any) => { for (const item of ([] as any[]).concat(value)) rows.push({ ...item }); return Promise.resolve({ error: null }); },
      update: (patch: any) => ({ eq: (key: string, value: unknown) => { for (const row of rows) if (row[key] === value) Object.assign(row, patch); return Promise.resolve({ error: null }); } }),
    };
    return chain;
  };
  return { tables, from: (table: string) => query(table) };
}

describe('installing the showcase apps into an account', () => {
  const USER = '11111111-1111-4111-8111-111111111111';
  const setup = () => {
    const client = fakeClient({ community_settings: [{ key: 'install_showcase', value: { user_id: USER, slugs: ['budget-clair', 'chez-marcel', 'cap-sur-le-monde'] } }], community_templates: [], community_remixes: [], community_moderation_events: [] });
    const created: Array<{ userId: string; name: string; files: number; verified?: boolean }> = [];
    const service = createCommunityService({
      getSupabase: () => client as any, env: { CODEN_COMMUNITY: '1' },
      getOrganizationPlan: async () => 'business', loadPublishedSnapshot: async () => null, listPublishedProjects: async () => [], loadProjectOwned: async () => null,
      createProjectFromFiles: async input => { created.push({ userId: input.userId, name: input.name, files: input.files.length, verified: input.verified }); return { id: `project-${created.length}`, name: input.name }; },
      accountCreatedAt: async () => null, sendUserEmail: async () => false,
    });
    return { client, created, service };
  };

  it('registers the templates first, then creates one ready project per app in that account', async () => {
    const { client, created, service } = setup();
    const result = await service.installShowcase();
    expect(result.installed).toEqual(['budget-clair', 'chez-marcel', 'cap-sur-le-monde']);
    expect(created.map(item => item.name)).toEqual(['Budget Clair', 'Chez Marcel', 'Cap sur le monde']);
    expect(created.every(item => item.userId === USER && item.files > 20 && item.verified === true)).toBe(true);
    expect(client.tables.community_templates.filter(row => row.kind === 'app')).toHaveLength(3);
    expect(client.tables.community_remixes.map(row => row.template_id)).toEqual(['budget-clair', 'chez-marcel', 'cap-sur-le-monde']);
  });

  it('never installs twice: a second pass, or a restart, leaves the account as it is', async () => {
    const { created, service } = setup();
    await service.installShowcase();
    expect((await service.installShowcase()).installed).toEqual([]);
    expect(created).toHaveLength(3);
  });

  it('does nothing without a request, or with the feature off', async () => {
    const empty = createCommunityService({ getSupabase: () => fakeClient({ community_settings: [] }) as any, env: { CODEN_COMMUNITY: '1' }, getOrganizationPlan: async () => 'free', loadPublishedSnapshot: async () => null, listPublishedProjects: async () => [], loadProjectOwned: async () => null, createProjectFromFiles: async () => { throw new Error('must not run'); }, accountCreatedAt: async () => null, sendUserEmail: async () => false });
    expect((await empty.installShowcase()).installed).toEqual([]);
    const off = createCommunityService({ getSupabase: () => fakeClient({}) as any, env: {}, getOrganizationPlan: async () => 'free', loadPublishedSnapshot: async () => null, listPublishedProjects: async () => [], loadProjectOwned: async () => null, createProjectFromFiles: async () => { throw new Error('must not run'); }, accountCreatedAt: async () => null, sendUserEmail: async () => false });
    expect((await off.installShowcase()).installed).toEqual([]);
  });
});
