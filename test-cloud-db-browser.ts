// Unit tests for the read-only Cloud DB Browser query builders (pure, no I/O).
// Guards: SQL-injection-proof identifier handling, schema allow-list (auth/pg_*
// never exposed), read-only-only output, and bounded pagination.

import assert from 'node:assert/strict';
import {
  isValidIdentifier,
  isExposableSchema,
  quoteIdentifier,
  sanitizeLimit,
  sanitizeOffset,
  sanitizeOrderDir,
  assertReadOnlySql,
  buildSchemasQuery,
  buildTablesQuery,
  buildColumnsQuery,
  buildCountQuery,
  buildRowsQuery,
  MAX_PAGE_ROWS,
} from './src/services/cloud-db-browser.ts';

// ── Identifier validation (anti-injection) ───────────────────────────────────
{
  assert.equal(isValidIdentifier('users'), true);
  assert.equal(isValidIdentifier('app_orders_2024'), true);
  for (const evil of [
    'users; drop table x',
    'users--',
    'users"',
    "users'",
    'users)',
    'users (',
    'a b',
    'Users', // uppercase rejected by strict charset
    '',
    'x'.repeat(64),
    'café',
    'a;b',
  ]) {
    assert.equal(isValidIdentifier(evil), false, `reject identifier ${JSON.stringify(evil)}`);
  }
}

// ── Schema allow-list: sensitive schemas are NEVER exposable ──────────────────
{
  assert.equal(isExposableSchema('public'), true);
  assert.equal(isExposableSchema('app_proj123'), true);
  for (const blocked of ['auth', 'storage', 'vault', 'pg_catalog', 'pg_toast', 'information_schema', 'extensions', 'graphql', 'realtime', 'supabase_migrations', 'secrets']) {
    assert.equal(isExposableSchema(blocked), false, `block schema ${blocked}`);
  }
  // A schema that is neither public nor app_* is rejected even if syntactically valid.
  assert.equal(isExposableSchema('analytics'), false, 'non app schema rejected');
  // Injection attempt as a schema name is rejected.
  assert.equal(isExposableSchema('public; select'), false);
}

// ── Builders refuse to target sensitive schemas / bad identifiers ─────────────
{
  assert.throws(() => buildTablesQuery('auth'), /SCHEMA_NOT_EXPOSABLE/, 'cannot list auth tables');
  assert.throws(() => buildColumnsQuery('auth', 'users'), /SCHEMA_NOT_EXPOSABLE/, 'cannot read auth.users columns');
  assert.throws(() => buildRowsQuery({ schema: 'auth', table: 'users', columns: ['id'], limit: 10, offset: 0 }), /SCHEMA_NOT_EXPOSABLE/, 'cannot read auth.users rows');
  assert.throws(() => buildColumnsQuery('public', 'bad table'), /INVALID_IDENTIFIER/);
  assert.throws(() => quoteIdentifier('x"; drop'), /INVALID_IDENTIFIER/);
}

// ── Every builder emits read-only SQL ─────────────────────────────────────────
{
  const queries = [
    buildSchemasQuery(),
    buildTablesQuery('public'),
    buildColumnsQuery('public', 'orders'),
    buildCountQuery('public', 'orders'),
    buildRowsQuery({ schema: 'public', table: 'orders', columns: ['id', 'total'], orderBy: 'id', orderDir: 'desc', limit: 50, offset: 0 }),
  ];
  for (const q of queries) {
    assert.equal(assertReadOnlySql(q), true, `read-only: ${q}`);
    assert.ok(!/;/.test(q), 'no statement separator');
  }
  // assertReadOnlySql rejects anything that is not a bare read.
  for (const bad of [
    'update orders set total = 0',
    'delete from orders',
    'drop table orders',
    'select 1; drop table orders',
    'select 1 -- comment',
    'insert into x values (1)',
    'select pg_sleep(10) /* x */',
    'truncate orders',
  ]) {
    assert.equal(assertReadOnlySql(bad), false, `reject: ${bad}`);
  }
}

// ── Quoting + structure of the rows query ────────────────────────────────────
{
  const q = buildRowsQuery({ schema: 'public', table: 'orders', columns: ['id', 'customer_email'], orderBy: 'id', orderDir: 'asc', limit: 25, offset: 50 });
  assert.ok(q.includes('"public"."orders"'), 'schema.table quoted');
  assert.ok(q.includes('"id", "customer_email"'), 'explicit quoted columns (never *)');
  assert.ok(!q.includes('*'), 'never SELECT *');
  assert.ok(q.includes('order by "id" asc'), 'order by quoted column');
  assert.ok(q.endsWith('limit 25 offset 50'), 'bounded pagination');
  // Order by a column NOT in the list is rejected (no arbitrary expressions).
  assert.throws(() => buildRowsQuery({ schema: 'public', table: 'orders', columns: ['id'], orderBy: 'secret', limit: 10, offset: 0 }), /ORDER_COLUMN_NOT_ALLOWED/);
  // An injected column name is filtered out; empty result throws rather than running.
  assert.throws(() => buildRowsQuery({ schema: 'public', table: 'orders', columns: ['id); drop table x --'], limit: 10, offset: 0 }), /NO_VALID_COLUMNS/);
}

// ── Pagination bounds ─────────────────────────────────────────────────────────
{
  assert.equal(sanitizeLimit(9999), MAX_PAGE_ROWS, 'limit capped at max');
  assert.equal(sanitizeLimit(0), 50, 'non-positive limit -> default');
  assert.equal(sanitizeLimit(10), 10);
  assert.equal(sanitizeOffset(-5), 0, 'negative offset -> 0');
  assert.equal(sanitizeOffset(250000), 100000, 'offset capped');
  assert.equal(sanitizeOrderDir('DESC'), 'desc');
  assert.equal(sanitizeOrderDir('weird'), 'asc', 'unknown dir -> asc');
}

console.log('test-cloud-db-browser: all assertions passed');
