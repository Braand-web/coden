import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CommunityStore } from './store';

const migration = readFileSync(new URL('../../../supabase/migrations/20261002000000_community_template_likes.sql', import.meta.url), 'utf8');
const server = readFileSync(new URL('../../../server.ts', import.meta.url), 'utf8');

type Row = Record<string, any>;

function fakeClient(initial: Record<string, Row[]>) {
  const tables = structuredClone(initial);
  const client = {
    from(table: string) {
      let filters: Array<[string, unknown, 'eq' | 'in']> = [];
      let operation: 'select' | 'insert' | 'delete' = 'select';
      let payload: Row | null = null;
      const query: any = {};
      const matching = () => (tables[table] || []).filter(row => filters.every(([key, value, kind]) => kind === 'eq' ? row[key] === value : (value as unknown[]).includes(row[key])));
      query.select = () => query;
      query.eq = (key: string, value: unknown) => { filters.push([key, value, 'eq']); return query; };
      query.in = (key: string, value: unknown[]) => { filters.push([key, value, 'in']); return query; };
      query.order = () => query;
      query.maybeSingle = async () => ({ data: matching()[0] || null, error: null });
      query.delete = () => { operation = 'delete'; return query; };
      query.insert = (row: Row) => { operation = 'insert'; payload = row; return query; };
      query.then = (resolve: (result: any) => unknown) => {
        if (operation === 'insert') {
          const duplicate = (tables[table] || []).some(row => row.template_slug === payload?.template_slug && row.user_id === payload?.user_id);
          if (duplicate) return resolve({ data: null, error: { code: '23505', message: 'duplicate' } });
          tables[table] ||= [];
          tables[table].push(payload!);
          const parent = tables.community_templates.find(row => row.slug === payload!.template_slug);
          if (parent) parent.like_count += 1;
        } else if (operation === 'delete') {
          const removed = matching();
          tables[table] = (tables[table] || []).filter(row => !removed.includes(row));
          const parent = tables.community_templates.find(row => row.slug === filters.find(([key]) => key === 'template_slug')?.[1]);
          if (parent) parent.like_count = Math.max(0, parent.like_count - removed.length);
        }
        return resolve({ data: matching(), error: null });
      };
      return query;
    },
  };
  return { client, tables };
}

const officialTemplate = { slug: 'atelier', title: 'Atelier', description: 'Boutique', category: 'e-commerce', version: 1, min_plan: 'free', design_score: 90, use_count: 0, like_count: 0, position: 1, kind: 'app', preview_url: null, active: true };

describe('official template likes', () => {
  it('keeps template likes server-only and protects browser access with RLS', () => {
    expect(migration).toContain('primary key (template_slug, user_id)');
    expect(migration).toContain('alter table public.community_template_likes enable row level security');
    expect(migration).toContain('revoke all on table public.community_template_likes from public, anon, authenticated');
    expect(migration).toContain('grant select, insert, delete on table public.community_template_likes to service_role');
    expect(migration).toContain('create trigger community_template_likes_sync_count');
    expect(migration).toContain("notify pgrst, 'reload schema'");
    expect(migration).not.toMatch(/create\s+policy/i);
  });

  it('bootstraps the schema only against Coden’s canonical Supabase project', () => {
    expect(server).toContain("const projectRef = getSupabaseProjectRef(process.env.SUPABASE_URL || '')");
    expect(server).toContain("'20261002000000_community_template_likes.sql'");
    expect(server).toContain('void ensureCommunityTemplateLikesSchema().catch');
    expect(server).not.toContain('CODEN_APP_RUNTIME_SUPABASE_URL');
  });

  it('persists the like and count across a reload, then removes it on the next click', async () => {
    const { client } = fakeClient({ community_templates: [officialTemplate], community_template_likes: [] });
    const store = new CommunityStore(client);

    expect(await store.templates('user-a')).toMatchObject([{ likes: 0, liked: false }]);
    expect(await store.toggleTemplateLike('atelier', 'user-a')).toEqual({ liked: true, likes: 1 });
    expect(await new CommunityStore(client).templates('user-a')).toMatchObject([{ likes: 1, liked: true }]);
    expect(await store.toggleTemplateLike('atelier', 'user-a')).toEqual({ liked: false, likes: 0 });
    expect(await store.templates('user-a')).toMatchObject([{ likes: 0, liked: false }]);
  });

  it('keeps likes isolated by account while exposing the shared total', async () => {
    const { client } = fakeClient({ community_templates: [officialTemplate], community_template_likes: [] });
    const store = new CommunityStore(client);
    await store.toggleTemplateLike('atelier', 'user-a');
    await store.toggleTemplateLike('atelier', 'user-b');

    expect(await store.templates('user-a')).toMatchObject([{ likes: 2, liked: true }]);
    expect(await store.templates('user-b')).toMatchObject([{ likes: 2, liked: true }]);
    expect(await store.templates('user-c')).toMatchObject([{ likes: 2, liked: false }]);
  });
});
