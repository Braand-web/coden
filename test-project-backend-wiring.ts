import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  describeProjectBackend,
  loadProjectBackendEnv,
  saveProvisionedBackend,
} from './src/services/project-backend-store.ts';

/*
 * A generated application reaches the backend it was given.
 *
 * Every piece of this existed and none of them touched.
 * `supabase-auto-provision` creates a dedicated Supabase project per app —
 * database, auth, storage — and the creation route calls it.
 * `coden_cloud_projects` has carried `supabase_project_ref`, `supabase_url`
 * and `anon_key_encrypted` since the Coden Cloud foundation migration.
 * `launchProjectPreview` takes an `env` map. The `react-supabase` starter,
 * which `selectStarter` picks whenever a prompt says auth, users, or
 * database, builds its client from `VITE_SUPABASE_URL` and
 * `VITE_SUPABASE_ANON_KEY`.
 *
 * Between them, nothing: the provisioning result went into the creation
 * response and was dropped, the row stayed at `status: 'planned'` with no
 * credentials, the pipeline launched with no env, and the app came up saying
 * "Supabase is not configured yet" — the scaffold being honest about a backend
 * nobody connected.
 */

/** A Supabase-shaped double: enough of the builder to record what was asked. */
function fakeClient(seed: Record<string, any> | null = null) {
  const rows: any[] = seed ? [seed] : [];
  const calls: Array<{ op: string; rows?: any[] }> = [];
  const chain: any = {
    select() { return chain; },
    eq() { return chain; },
    upsert(written: any[]) { calls.push({ op: 'upsert', rows: written }); rows.splice(0, rows.length, ...written); return Promise.resolve({ error: null }); },
    maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
  };
  return { client: { from: () => chain }, rows, calls };
}

const PROVISIONED = {
  ref: 'abcdefghij0123456789',
  url: 'https://abcdefghij0123456789.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon',
  serviceRoleKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service_role',
  region: 'eu-west-1',
  status: 'ACTIVE_HEALTHY',
};

// What was provisioned is written down, on the row that was already waiting.
{
  const { client, calls, rows } = fakeClient();
  assert.equal(await saveProvisionedBackend({ client, projectId: 'p1', organizationId: 'org1', provisioned: PROVISIONED }), true);
  assert.equal(calls.length, 1);
  assert.equal(rows[0].supabase_project_ref, PROVISIONED.ref);
  assert.equal(rows[0].supabase_url, PROVISIONED.url);
  assert.equal(rows[0].status, 'active', 'the row must leave "planned"');
  assert.equal(rows[0].mode, 'dedicated');
}

/*
 * The service role key is never stored.
 *
 * Nothing in this repository encrypts anything — the `_encrypted` column
 * suffix is aspirational, there is no cipher behind it. The anon key is public
 * by design and ships in every browser bundle; the service role key bypasses
 * every row-level policy. Writing it into a column that claims an encryption
 * it does not perform would be worse than not storing it.
 */
{
  const { client, rows } = fakeClient();
  await saveProvisionedBackend({ client, projectId: 'p1', provisioned: PROVISIONED });
  const serialized = JSON.stringify(rows[0]);
  assert.ok(!serialized.includes(PROVISIONED.serviceRoleKey), 'the service role key must not be persisted');
  assert.ok(!serialized.includes('service_role_key_encrypted'), 'nor its column written at all');
  assert.ok(serialized.includes(PROVISIONED.anonKey), 'the anon key is public and is what the app needs');
}

// A run reads it back as the environment its dev server needs.
{
  const { client } = fakeClient({
    supabase_url: PROVISIONED.url,
    anon_key_encrypted: PROVISIONED.anonKey,
    status: 'active',
  });
  assert.deepEqual(await loadProjectBackendEnv({ client, projectId: 'p1' }), {
    VITE_SUPABASE_URL: PROVISIONED.url,
    VITE_SUPABASE_ANON_KEY: PROVISIONED.anonKey,
  }, 'exactly the two names the react-supabase starter reads');
}

/*
 * A half-provisioned backend gives nothing.
 *
 * A client built from a URL with no key fails at the first query, deep in the
 * app, instead of at the scaffold's own configuration check — which renders an
 * honest "not configured" state.
 */
{
  const { client } = fakeClient({ supabase_url: PROVISIONED.url, anon_key_encrypted: '' });
  assert.deepEqual(await loadProjectBackendEnv({ client, projectId: 'p1' }), {});
}

// A backend is an improvement to a run, never a precondition for one.
{
  const broken = { from() { throw new Error('table missing'); } };
  assert.deepEqual(await loadProjectBackendEnv({ client: broken as any, projectId: 'p1' }), {}, 'a broken backend table must not stop a generation');
  assert.deepEqual(await loadProjectBackendEnv({ client: null, projectId: 'p1' }), {}, 'and neither must an absent one');
  assert.equal(await saveProvisionedBackend({ client: broken as any, projectId: 'p1', provisioned: PROVISIONED }), false);
  assert.equal(await saveProvisionedBackend({ client: fakeClient().client, projectId: 'p1', provisioned: { ref: '', url: '', anonKey: '' } }), false, 'an empty provision is not a backend');
}

/*
 * Nothing tells an agent a database exists when none does.
 *
 * The one failure worse than no backend is an application written against one
 * that is not there: it builds, it renders, and every button fails.
 */
{
  assert.equal(describeProjectBackend({}), undefined);
  assert.equal(describeProjectBackend({ VITE_SUPABASE_URL: PROVISIONED.url }), undefined, 'a URL alone is not a backend');

  const briefing = describeProjectBackend({ VITE_SUPABASE_URL: PROVISIONED.url, VITE_SUPABASE_ANON_KEY: PROVISIONED.anonKey })!;
  assert.match(briefing, /src\/lib\/supabase\.ts/, 'the agent is pointed at the client the scaffold ships');
  assert.match(briefing, /row-level security/i, 'the anon key is public, so policies are not optional');
  assert.match(briefing, /auth\.uid\(\)/, 'and scoped to the signed-in user');
  assert.match(briefing, /service role key is not available/i, 'the key that bypasses every policy stays out of browser code');
  assert.match(briefing, /localStorage stand-in|mock arrays/, 'and the hedge the agent reaches for without this is named');
  assert.ok(!briefing.includes(PROVISIONED.serviceRoleKey), 'no secret in a prompt');
}

/*
 * And it has to be wired where the run actually happens. This is what was
 * missing: every module existed, nothing called them.
 */
{
  const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

  // Persisted at creation, rather than announced once and lost.
  const provision = server.slice(server.indexOf('[coden:supabase_auto_provisioned]') - 1400, server.indexOf('[coden:supabase_auto_provisioned]'));
  assert.match(provision, /saveProvisionedBackend\(\{/, 'the provisioning result must be written down');

  // Loaded for the run, and handed to it.
  const branch = server.slice(server.indexOf('const outcome = await runMultiAgentPipeline({') - 1600);
  assert.match(branch, /loadProjectBackendEnv\(\{/, 'the run must load which Supabase project this app belongs to');
  assert.match(branch, /\n\s*backendEnv,/, 'and pass it in');
}

// The sandbox receives it, which is the only reason any of this matters.
{
  const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
  const launch = pipeline.slice(pipeline.indexOf('const launch = await launchProjectPreview({'), pipeline.indexOf('const launch = await launchProjectPreview({') + 1200);
  assert.match(launch, /env: input\.backendEnv/, 'the dev server must be given the backend environment');

  // Both agents are told, for the reason each needs it.
  assert.match(pipeline, /const backendBriefing = describeProjectBackend\(/, 'the briefing is built once');
  const briefed = pipeline.match(/\[designPolicy, backendBriefing\]\.filter\(Boolean\)/g) || [];
  assert.equal(briefed.length, 2, 'the planner and the coder both receive it');
}

console.log('project backend wiring tests passed');
