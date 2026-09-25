/** A small in-memory Supabase, just the query shapes the library store uses. */
import { randomUUID } from 'node:crypto';

type Row = Record<string, any>;
type Filter = (row: Row) => boolean;

class Query implements PromiseLike<{ data: any; error: any }> {
  private filters: Filter[] = [];
  private mode: 'select' | 'update' | 'delete' = 'select';
  private patch: Row = {};
  private single = false;
  private limitCount = Infinity;
  private orders: Array<[string, boolean]> = [];
  constructor(private readonly rows: Row[]) {}
  select() { return this; }
  update(patch: Row) { this.mode = 'update'; this.patch = patch; return this; }
  delete() { this.mode = 'delete'; return this; }
  eq(column: string, value: unknown) { this.filters.push(row => row[column] === value); return this; }
  neq(column: string, value: unknown) { this.filters.push(row => row[column] !== value); return this; }
  in(column: string, values: unknown[]) { this.filters.push(row => values.includes(row[column])); return this; }
  contains(column: string, values: unknown[]) { this.filters.push(row => values.every(value => (row[column] || []).includes(value))); return this; }
  or(expression: string) {
    const parts = expression.split(',').map(part => /^(\w+)\.ilike\.%(.*)%$/.exec(part)).filter(Boolean) as RegExpExecArray[];
    this.filters.push(row => parts.some(([, column, text]) => String(row[column] || '').toLowerCase().includes(text.toLowerCase())));
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) { this.orders.push([column, options.ascending !== false]); return this; }
  limit(count: number) { this.limitCount = count; return this; }
  maybeSingle() { this.single = true; return this; }
  private run() {
    const matched = this.rows.filter(row => this.filters.every(filter => filter(row)));
    if (this.mode === 'update') { matched.forEach(row => Object.assign(row, this.patch)); return { data: null, error: null }; }
    if (this.mode === 'delete') { for (const row of matched) this.rows.splice(this.rows.indexOf(row), 1); return { data: null, error: null }; }
    let data = matched.map(row => ({ ...row }));
    for (const [column, ascending] of [...this.orders].reverse()) data.sort((a, b) => (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0) * (ascending ? 1 : -1));
    data = data.slice(0, this.limitCount);
    return { data: this.single ? data[0] || null : data, error: null };
  }
  then<T1, T2>(resolve?: ((value: { data: any; error: any }) => T1 | PromiseLike<T1>) | null, reject?: ((reason: any) => T2 | PromiseLike<T2>) | null) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
}

const DEFAULTS: Record<string, Row> = {
  agent_library_items: { version: 1, status: 'candidate', is_latest: true, parent_id: null, tags: [], uses: 0, successes: 0, failures: 0, contributors: [], created_by: 'agent', disabled_reason: null, last_used_at: null, embedding: null },
  agent_error_memory: { status: 'candidate', permanent: false, occurrences: 1, confirmations: 0, recurrences_after_rule: 0, skill_id: null, contributors: [], embedding: null, edited_by_admin: false, last_recurrence_at: null, context: {} },
  agent_library_usage: {},
};

export function fakeSupabase() {
  const tables: Record<string, Row[]> = { agent_library_items: [], agent_error_memory: [], agent_library_usage: [] };
  const client = {
    tables,
    from(table: string) {
      tables[table] ??= [];
      const query = new Query(tables[table]);
      return Object.assign(query, {
        insert: async (rows: Row[]) => {
          for (const row of rows) tables[table].push({ id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...DEFAULTS[table], ...row });
          return { data: null, error: null };
        },
      });
    },
  };
  return client;
}
