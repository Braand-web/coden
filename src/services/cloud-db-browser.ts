/**
 * Cloud DB Browser — pure, server-side query builders for a READ-ONLY table
 * browser over a project's provisioned Supabase database.
 *
 * THREAT MODEL: SQL injection is the #1 risk. The client NEVER sends SQL. It
 * sends structured parameters (schema, table, optional sort column, page). This
 * module:
 *  - validates every identifier (strict charset + length),
 *  - quotes/qualifies identifiers ("schema"."table") — identifiers can never be
 *    SQL parameters, so validation + quoting is the only safe path,
 *  - allow-lists exposable schemas (public, app_*) and hard-denies sensitive
 *    ones (auth, storage, vault, pg_*, information_schema as data, …) so the
 *    browser can never reveal app end-users' auth identifiers,
 *  - builds ONLY SELECT / information_schema reads, always bounded by LIMIT,
 *  - exposes assertReadOnlySql() as defense-in-depth (paired with
 *    classifyMigrationSafety() in the server) so a write can never run.
 *
 * No secrets live here. The Management token / service_role stay in server.ts.
 * Callers MUST still verify a table actually exists (via the columns query)
 * before building a rows query — buildRowsQuery trusts pre-validated column lists.
 */

export const MAX_PAGE_ROWS = 100;
export const DEFAULT_PAGE_ROWS = 50;
export const MAX_OFFSET = 100_000;
export const STATEMENT_TIMEOUT_MS = 4000;

// Postgres identifier: lowercase letters/digits/underscore, <= 63 chars.
const IDENTIFIER_RE = /^[a-z0-9_]+$/;
const MAX_IDENTIFIER_LEN = 63;

// Schemas that must NEVER be browsable, even if a regex would otherwise pass.
const BLOCKED_SCHEMAS = new Set<string>([
  'auth',
  'storage',
  'vault',
  'pgsodium',
  'pgsodium_masks',
  'pg_catalog',
  'pg_toast',
  'information_schema',
  'extensions',
  'graphql',
  'graphql_public',
  'realtime',
  'supabase_functions',
  'supabase_migrations',
  'net',
  'cron',
  'pgbouncer',
  'secrets',
]);

export function isValidIdentifier(name: unknown): boolean {
  const value = String(name == null ? '' : name);
  return value.length > 0 && value.length <= MAX_IDENTIFIER_LEN && IDENTIFIER_RE.test(value);
}

/** A schema is exposable only if it is `public` or an `app_*` app schema, and
 *  not in the hard deny-list. */
export function isExposableSchema(name: unknown): boolean {
  const value = String(name == null ? '' : name);
  if (!isValidIdentifier(value)) return false;
  if (BLOCKED_SCHEMAS.has(value)) return false;
  if (value.startsWith('pg_')) return false;
  return value === 'public' || value.startsWith('app_');
}

/** Quote an identifier for safe interpolation. Validates first; the charset
 *  excludes the quote char, so this cannot be broken out of. */
export function quoteIdentifier(name: string): string {
  if (!isValidIdentifier(name)) throw new Error('INVALID_IDENTIFIER');
  return `"${name}"`;
}

/** Quote a validated identifier as a SQL string literal (for information_schema
 *  WHERE clauses). Only ever called with already-validated identifiers. */
function quoteValidatedLiteral(name: string): string {
  if (!isValidIdentifier(name)) throw new Error('INVALID_IDENTIFIER');
  return `'${name}'`;
}

export function sanitizeLimit(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_ROWS;
  return Math.min(MAX_PAGE_ROWS, n);
}

export function sanitizeOffset(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_OFFSET, n);
}

export function sanitizeOrderDir(value: unknown): 'asc' | 'desc' {
  return String(value || '').toLowerCase() === 'desc' ? 'desc' : 'asc';
}

// Forbidden as whole words: any write/DDL/permission/utility keyword.
const FORBIDDEN_SQL = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|copy|call|do|merge|vacuum|analyze|reindex|cluster|lock|set|reset|begin|commit|rollback|savepoint|listen|notify|prepare|execute|refresh|import|security|definer|into)\b/i;

/** Defense-in-depth: the assembled query must be a single bare SELECT/CTE with
 *  no statement separators, comments, or write keywords. */
export function assertReadOnlySql(sql: string): boolean {
  const text = String(sql || '').trim();
  if (!text) return false;
  if (!/^(select|with|table)\b/i.test(text)) return false;
  if (text.includes(';')) return false; // no statement chaining
  if (text.includes('--') || text.includes('/*') || text.includes('*/')) return false;
  if (FORBIDDEN_SQL.test(text)) return false;
  return true;
}

/** Schemas exposable to the browser (public + app_*). */
export function buildSchemasQuery(): string {
  return [
    'select schema_name',
    'from information_schema.schemata',
    "where (schema_name = 'public' or schema_name like 'app\\_%')",
    'order by schema_name',
    'limit 200',
  ].join(' ');
}

/** Tables + views inside one exposable schema. */
export function buildTablesQuery(schema: string): string {
  if (!isExposableSchema(schema)) throw new Error('SCHEMA_NOT_EXPOSABLE');
  return [
    'select table_schema, table_name, table_type',
    'from information_schema.tables',
    `where table_schema = ${quoteValidatedLiteral(schema)}`,
    "and table_type in ('BASE TABLE', 'VIEW')",
    'order by table_name',
    'limit 500',
  ].join(' ');
}

/** Columns + types of one table (also used to verify the table exists). */
export function buildColumnsQuery(schema: string, table: string): string {
  if (!isExposableSchema(schema)) throw new Error('SCHEMA_NOT_EXPOSABLE');
  if (!isValidIdentifier(table)) throw new Error('INVALID_IDENTIFIER');
  return [
    'select column_name, data_type, is_nullable, ordinal_position',
    'from information_schema.columns',
    `where table_schema = ${quoteValidatedLiteral(schema)} and table_name = ${quoteValidatedLiteral(table)}`,
    'order by ordinal_position',
    'limit 500',
  ].join(' ');
}

/** Total row count for a verified table. */
export function buildCountQuery(schema: string, table: string): string {
  if (!isExposableSchema(schema)) throw new Error('SCHEMA_NOT_EXPOSABLE');
  if (!isValidIdentifier(table)) throw new Error('INVALID_IDENTIFIER');
  return `select count(*)::bigint as count from ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

export interface RowsQueryInput {
  schema: string;
  table: string;
  /** Pre-validated, existing columns (from information_schema). Never `*`. */
  columns: string[];
  orderBy?: string | null;
  orderDir?: 'asc' | 'desc';
  limit: number;
  offset: number;
}

/**
 * Build a bounded SELECT of explicit columns. `columns` and `orderBy` MUST come
 * from the table's real column set (verified by the caller) — they are quoted as
 * identifiers but the caller is responsible for membership/allow-listing.
 */
export function buildRowsQuery(input: RowsQueryInput): string {
  if (!isExposableSchema(input.schema)) throw new Error('SCHEMA_NOT_EXPOSABLE');
  if (!isValidIdentifier(input.table)) throw new Error('INVALID_IDENTIFIER');
  const cols = (input.columns || []).filter(isValidIdentifier);
  if (!cols.length) throw new Error('NO_VALID_COLUMNS');
  const selectList = cols.map(quoteIdentifier).join(', ');
  const limit = sanitizeLimit(input.limit);
  const offset = sanitizeOffset(input.offset);
  let orderClause = '';
  if (input.orderBy) {
    if (!cols.includes(input.orderBy)) throw new Error('ORDER_COLUMN_NOT_ALLOWED');
    orderClause = ` order by ${quoteIdentifier(input.orderBy)} ${sanitizeOrderDir(input.orderDir)}`;
  }
  return `select ${selectList} from ${quoteIdentifier(input.schema)}.${quoteIdentifier(input.table)}${orderClause} limit ${limit} offset ${offset}`;
}
