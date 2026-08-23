import assert from 'node:assert/strict';
import {
  applyGeneratedMigration,
  buildApplyMigrationRequest,
  classifyMigrationSafety,
  isValidProjectRef,
  redactManagementToken,
  resolveManagementToken,
} from './src/services/supabase-provisioning.ts';

const SAFE_SQL = `create table if not exists public.app_records (
  id uuid primary key default gen_random_uuid(),
  title text not null
);
alter table public.app_records enable row level security;`;

const DESTRUCTIVE_SQL = `drop table public.app_records;`;
// Built at runtime so the literal token pattern never appears in source
// (avoids tripping GitHub secret-scanning push protection on a fake value).
const FAKE_TOKEN = 'sbp_' + '0'.repeat(40);
const VALID_REF = 'abcdefghij0123456789';

// ── Safety classification ───────────────────────────────────────────────────
const safe = classifyMigrationSafety(SAFE_SQL);
assert.equal(safe.destructive, false, 'CREATE TABLE migration must be non-destructive');
assert.equal(safe.statements, 2);

const destructive = classifyMigrationSafety(DESTRUCTIVE_SQL);
assert.equal(destructive.destructive, true);
assert.ok(destructive.flagged.includes('drop table'));

assert.equal(classifyMigrationSafety('truncate public.app_records;').destructive, true);
assert.equal(classifyMigrationSafety('delete from public.app_records;').destructive, true, 'DELETE without WHERE is destructive');
assert.equal(classifyMigrationSafety('delete from public.app_records where id = 1;').destructive, false, 'DELETE with WHERE is allowed');

// ── Project ref validation ──────────────────────────────────────────────────
assert.equal(isValidProjectRef(VALID_REF), true);
assert.equal(isValidProjectRef('too-short'), false);
assert.equal(isValidProjectRef('ABCDEFGHIJ0123456789'), false, 'refs are lowercase');

// ── Token redaction ─────────────────────────────────────────────────────────
assert.equal(redactManagementToken(`token is ${FAKE_TOKEN} ok`), 'token is sbp_***REDACTED*** ok');
assert.match(redactManagementToken('Authorization: Bearer sbp_abc.def-123'), /Bearer \*\*\*REDACTED\*\*\*/);

// ── Request building ────────────────────────────────────────────────────────
const request = buildApplyMigrationRequest({ projectRef: VALID_REF, sql: SAFE_SQL, token: FAKE_TOKEN });
assert.equal(request.url, `https://api.supabase.com/v1/projects/${VALID_REF}/database/query`);
assert.equal(request.method, 'POST');
assert.equal(request.headers.authorization, `Bearer ${FAKE_TOKEN}`);
assert.match(request.body, /create table if not exists public\.app_records/);
assert.throws(() => buildApplyMigrationRequest({ projectRef: 'bad', sql: SAFE_SQL, token: FAKE_TOKEN }), /INVALID_PROJECT_REF/);
assert.throws(() => buildApplyMigrationRequest({ projectRef: VALID_REF, sql: '', token: FAKE_TOKEN }), /EMPTY_MIGRATION/);
assert.throws(() => buildApplyMigrationRequest({ projectRef: VALID_REF, sql: SAFE_SQL, token: 'nope' }), /INVALID_MANAGEMENT_TOKEN/);

// ── Token resolution from env ───────────────────────────────────────────────
assert.equal(resolveManagementToken('sbp_explicit'), 'sbp_explicit');
delete process.env.SUPABASE_MANAGEMENT_TOKEN;
delete process.env.SUPABASE_ACCESS_TOKEN;
assert.equal(resolveManagementToken(), '');
process.env.SUPABASE_MANAGEMENT_TOKEN = FAKE_TOKEN;
assert.equal(resolveManagementToken(), FAKE_TOKEN);

// ── applyGeneratedMigration: safe by default ────────────────────────────────
const dry = await applyGeneratedMigration({ projectRef: VALID_REF, sql: SAFE_SQL });
assert.equal(dry.dryRun, true, 'dry-run is the default');
assert.equal(dry.applied, false);

// Destructive refused without override, even when executing.
const refused = await applyGeneratedMigration({ projectRef: VALID_REF, sql: DESTRUCTIVE_SQL, dryRun: false });
assert.equal(refused.applied, false);
assert.match(refused.error || '', /destructive/i);

// Successful apply via mock fetch — and the result must never leak the token.
let capturedUrl = '';
let capturedAuth = '';
const okFetch = (async (url: any, init: any) => {
  capturedUrl = String(url);
  capturedAuth = String(init?.headers?.authorization || '');
  return { ok: true, status: 201, text: async () => '[]' } as any;
}) as unknown as typeof fetch;

const applied = await applyGeneratedMigration({ projectRef: VALID_REF, sql: SAFE_SQL, dryRun: false, fetchImpl: okFetch });
assert.equal(applied.applied, true);
assert.equal(applied.status, 201);
assert.equal(capturedUrl, `https://api.supabase.com/v1/projects/${VALID_REF}/database/query`);
assert.equal(capturedAuth, `Bearer ${FAKE_TOKEN}`);
assert.doesNotMatch(JSON.stringify(applied), /sbp_[A-Za-z0-9]/, 'result must not contain the raw management token');

// Error responses must redact any token echoed back by the API.
const leakyFetch = (async () => ({ ok: false, status: 400, text: async () => `bad token ${FAKE_TOKEN}` }) as any) as unknown as typeof fetch;
const errored = await applyGeneratedMigration({ projectRef: VALID_REF, sql: SAFE_SQL, dryRun: false, fetchImpl: leakyFetch });
assert.equal(errored.applied, false);
assert.equal(errored.status, 400);
assert.doesNotMatch(errored.error || '', /sbp_[A-Za-z0-9]/, 'error must redact the management token');

// Missing token when executing for real.
delete process.env.SUPABASE_MANAGEMENT_TOKEN;
const noToken = await applyGeneratedMigration({ projectRef: VALID_REF, sql: SAFE_SQL, dryRun: false });
assert.equal(noToken.applied, false);
assert.equal(noToken.error, 'MISSING_MANAGEMENT_TOKEN');

// ── Publish-flow helpers ────────────────────────────────────────────────────
const { selectMigrationFromFiles, resolveProjectRef, provisionOnPublish } = await import('./src/services/supabase-provisioning.ts');

// Versioned migration is preferred over schema.sql.
const files = [
  { path: 'src/App.tsx', content: 'x' },
  { path: 'supabase/schema.sql', content: 'create table public.app_records();' },
  { path: 'supabase/migrations/0001_coden_fullstack.sql', content: 'create table public.app_versioned();' },
];
assert.equal(selectMigrationFromFiles(files)?.path, 'supabase/migrations/0001_coden_fullstack.sql');
assert.equal(selectMigrationFromFiles([{ path: 'src/App.tsx', content: 'x' }]), null);

// project ref resolution.
assert.equal(resolveProjectRef({ project_ref: VALID_REF }), VALID_REF);
assert.equal(resolveProjectRef({ supabaseUrl: `https://${VALID_REF}.supabase.co` }), VALID_REF);
assert.equal(resolveProjectRef({}), null);
assert.equal(resolveProjectRef(null), null);

// provisionOnPublish skips cleanly when prerequisites are missing.
delete process.env.SUPABASE_MANAGEMENT_TOKEN;
delete process.env.SUPABASE_ACCESS_TOKEN;
const noMig = await provisionOnPublish({ files: [{ path: 'src/App.tsx', content: 'x' }] });
assert.equal(noMig.skipped, true);
assert.equal(noMig.reason, 'no_migration');

const noRef = await provisionOnPublish({ files });
assert.equal(noRef.skipped, true);
assert.equal(noRef.reason, 'no_project_ref');

const noTok = await provisionOnPublish({ files, cloudConfig: { project_ref: VALID_REF } });
assert.equal(noTok.skipped, true);
assert.equal(noTok.reason, 'no_management_token');

// Full path with a mock fetch — dry-run default still does not execute.
const dryProvision = await provisionOnPublish({ files, cloudConfig: { project_ref: VALID_REF }, token: FAKE_TOKEN });
assert.equal(dryProvision.dryRun, true);
assert.equal(dryProvision.applied, false);

// Execute via mock fetch.
let calledUrl = '';
const okFetch2 = (async (url: any) => { calledUrl = String(url); return { ok: true, status: 201, text: async () => '[]' } as any; }) as unknown as typeof fetch;
const applied2 = await provisionOnPublish({ files, cloudConfig: { project_ref: VALID_REF }, token: FAKE_TOKEN, dryRun: false, fetchImpl: okFetch2 });
assert.equal(applied2.applied, true);
assert.match(calledUrl, new RegExp(`/projects/${VALID_REF}/database/query`));

console.log('test-supabase-provisioning passed');
