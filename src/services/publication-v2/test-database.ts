/** Local-only Postgres fixture. Never imported by the application server. */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error('Invalid SQL fixture identifier');
  return `"${name}"`;
};
export class LocalSqlClient {
  constructor(readonly db: PGlite) {}
  from(table: string) { return new LocalSqlQuery(this.db, table); }
  async rpc(name: string, args: Record<string, unknown> = {}) {
    try {
      const set = ['enqueue_agent_job', 'claim_agent_jobs', 'append_agent_job_event', 'finish_agent_job', 'resume_publish_job'].includes(name);
      const values = Object.entries(args).map(([key, value]) => key === 'p_types' && Array.isArray(value) ? `{${value.map(String).join(',')}}` : value && typeof value === 'object' ? JSON.stringify(value) : value);
      const result = await this.db.query(`select ${set ? '*' : ''} ${set ? 'from' : ''} public.${ident(name)}(${Object.keys(args).map((key, i) => `${ident(key)} => $${i + 1}`).join(',')}) ${set ? '' : 'as result'}`, values);
      return { data: set ? result.rows : (result.rows[0] as any)?.result ?? null, error: null };
    } catch (error: any) { return { data: null, error: { message: error.message, code: error.code } }; }
  }
}
class LocalSqlQuery implements PromiseLike<any> {
  private operation = 'select';
  private fields = '*';
  private rows: any;
  private filters: Array<{ key: string; op: string; value: unknown }> = [];
  private orders: string[] = [];
  private legacyOr = false;
  private count: number | null = null;
  private one = false;
  private conflict?: { onConflict: string; ignoreDuplicates?: boolean };
  constructor(private db: PGlite, private table: string) {}
  select(fields = '*') { this.fields = fields; return this; }
  insert(rows: any) { this.operation = 'insert'; this.rows = rows; return this; }
  upsert(rows: any, conflict: any) { this.operation = 'insert'; this.rows = rows; this.conflict = conflict; return this; }
  update(rows: any) { this.operation = 'update'; this.rows = rows; return this; }
  delete() { this.operation = 'delete'; return this; }
  eq(key: string, value: unknown) { this.filters.push({ key, op: '=', value }); return this; }
  gt(key: string, value: unknown) { this.filters.push({ key, op: '>', value }); return this; }
  lt(key: string, value: unknown) { this.filters.push({ key, op: '<', value }); return this; }
  in(key: string, value: unknown[]) { this.filters.push({ key, op: 'in', value }); return this; }
  not(key: string, op: string, value: unknown) { if (op !== 'like') throw new Error('Unsupported fixture query'); this.filters.push({ key, op: 'not like', value }); return this; }
  or(expression: string) { if (expression !== 'type.neq.publish,payload->>publication_snapshot_id.is.null') throw new Error('Unsupported fixture OR'); this.legacyOr = true; return this; }
  order(key: string, options: any = {}) { this.orders.push(`${ident(key)} ${options.ascending === false ? 'desc' : 'asc'}`); return this; }
  limit(count: number) { this.count = count; return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.one = true; return this; }
  async execute() {
    try {
      const values: unknown[] = [];
      const bind = (value: any) => { values.push(value && typeof value === 'object' ? JSON.stringify(value) : value); return `$${values.length}`; };
      const fields = this.fields === '*' ? '*' : this.fields.split(',').map(ident).join(',');
      const table = `public.${ident(this.table)}`;
      let sql: string;
      if (this.operation === 'insert') {
        const rows = Array.isArray(this.rows) ? this.rows : [this.rows];
        const keys = Object.keys(rows[0]);
        sql = `insert into ${table} (${keys.map(ident).join(',')}) values ${rows.map(row => `(${keys.map(key => bind(row[key])).join(',')})`).join(',')}`;
        const conflict = this.conflict;
        if (conflict) sql += ` on conflict (${conflict.onConflict.split(',').map(ident).join(',')}) do ${conflict.ignoreDuplicates ? 'nothing' : `update set ${keys.filter(k => !conflict.onConflict.split(',').includes(k)).map(k => `${ident(k)}=excluded.${ident(k)}`).join(',')}`}`;
        sql += ' returning *';
      } else {
        sql = this.operation === 'select' ? `select ${fields} from ${table}` : this.operation === 'delete' ? `delete from ${table}` : `update ${table} set ${Object.entries(this.rows).map(([key, value]) => `${ident(key)}=${bind(value)}`).join(',')}`;
        if (this.filters.length) sql += ' where ' + this.filters.map(filter => filter.op === 'in' ? `${ident(filter.key)} in (${(filter.value as any[]).map(bind).join(',')})` : `${ident(filter.key)} ${filter.op} ${bind(filter.value)}`).join(' and ');
        if (this.legacyOr) sql += `${this.filters.length ? ' and' : ' where'} (type <> 'publish' or payload->>'publication_snapshot_id' is null)`;
        if (this.operation === 'select') {
          if (this.orders.length) sql += ` order by ${this.orders.join(',')}`;
          if (this.count !== null) sql += ` limit ${Number(this.count)}`;
        } else sql += ' returning *';
      }
      const result = await this.db.query(sql, values);
      return { data: this.one ? result.rows[0] || null : result.rows, error: null };
    } catch (error: any) { return { data: null, error: { message: error.message, code: error.code } }; }
  }
  then<TResult1 = any, TResult2 = never>(onfulfilled?: (value: any) => TResult1 | PromiseLike<TResult1>, onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>): PromiseLike<TResult1 | TResult2> { return this.execute().then(onfulfilled, onrejected); }
}
export async function createPublicationTestDatabase(dataDir?: string) {
  const db = new PGlite(dataDir);
  if ((await db.query<any>("select to_regclass('public.project_publication_state') as existing")).rows[0].existing) return { db, client: new LocalSqlClient(db) };
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
    create table public.projects(id uuid primary key,owner_id uuid not null,organization_id uuid not null);
    create table public.project_members(project_id uuid,user_id uuid,role text);
    create table public.organization_members(organization_id uuid,user_id uuid,role text);`);
  await db.exec(`create table public.deployments(id uuid primary key,project_id uuid,organization_id uuid,provider text,provider_deployment_id text,deployment_url text,public_url text,status text,commit_hash text,branch text,badge_required boolean,created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.community_listings(id uuid primary key default gen_random_uuid(),project_id uuid,status text,updated_at timestamptz default now());`);
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const migrationDir = path.join(root, 'supabase/migrations');
  await db.exec(await fs.readFile(path.join(migrationDir, '20260609000003_agent_job_queue.sql'), 'utf8'));
  const names = (await fs.readdir(migrationDir)).filter(name => /(?:publication_v2|durable_agent_job_queue)/.test(name)).sort();
  for (const name of names) await db.exec(await fs.readFile(path.join(migrationDir, name), 'utf8'));
  return { db, client: new LocalSqlClient(db) };
}
