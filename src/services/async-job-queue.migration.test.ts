import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Real SQL in an isolated in-memory PostgreSQL runtime. No Supabase credentials,
// remote project, Docker, CLI database command, or production access is used.
const migration = readFileSync(new URL('../../supabase/migrations/20261015043041_durable_agent_job_queue.sql', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../supabase/migrations/20260609000003_agent_job_queue.sql', import.meta.url), 'utf8');
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const ORG = '44444444-4444-4444-8444-444444444444';
let db: PGlite;
let backfilled: number[];

async function rows<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}
async function enqueue(options: { type?: string; key?: string; payload?: unknown; project?: string; user?: string; priority?: string; max?: number } = {}) {
  return (await rows(`SELECT * FROM public.enqueue_agent_job($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`, [
    `durable-job-${randomUUID()}`, options.type ?? 'publish', options.project ?? PROJECT, options.user ?? USER, ORG,
    JSON.stringify(options.payload ?? { publication_snapshot_id: 'snapshot-1' }), options.priority ?? 'normal', options.max ?? 3, options.key ?? null,
  ]))[0];
}
async function claim(types = ['publish'], limit = 1) {
  return rows(`SELECT * FROM public.claim_agent_jobs('worker-a', $1, 60, $2::text[])`, [limit, types]);
}
async function finish(job: any, outcome = 'completed', retry = false) {
  return rows(`SELECT * FROM public.finish_agent_job($1,$2,$3,'{"ok":true}'::jsonb,NULL,$4,false)`, [job.id, job.lease_token, outcome, retry]);
}
async function resume(jobId: string, userId = USER) {
  return rows('SELECT * FROM public.resume_publish_job($1,$2)', [jobId, userId]);
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
  `);
  await db.exec(original);
  // Seed a pre-migration job to verify deterministic historical sequence backfill.
  await db.query(`INSERT INTO public.agent_jobs(id,type,project_id,user_id,organization_id)
    VALUES ('job_old','generate',$1,$2,$3)`, [PROJECT, USER, ORG]);
  await db.exec(`INSERT INTO public.agent_job_events(id,job_id,step,message,created_at) VALUES
    ('00000000-0000-4000-8000-000000000002','job_old','b','second','2026-01-01'),
    ('00000000-0000-4000-8000-000000000001','job_old','a','first','2026-01-01');`);
  await db.exec(migration);
  backfilled = (await rows(`SELECT sequence::integer FROM public.agent_job_events ORDER BY created_at,id`)).map(row => row.sequence);
}, 30000);
beforeEach(async () => {
  await db.exec('RESET ROLE; TRUNCATE public.agent_jobs CASCADE; SET ROLE service_role;');
});
afterAll(async () => { await db?.close(); });

describe('durable queue migration and SQL contracts', () => {
  it('backfills ordered historical event sequences and contains a SKIP LOCKED atomic claim', () => {
    expect(backfilled).toEqual([1, 2]);
    expect(migration).toMatch(/LIMIT p_limit FOR UPDATE SKIP LOCKED/);
  });

  it('supports direct transactional snapshot/job insertion with strict publish safety settings', async () => {
    // Main's publication migration intentionally knows only the original queue
    // columns and uses a normal job ID. The insert trigger promotes it atomically.
    const id = `job_${randomUUID()}`;
    await db.query(`INSERT INTO public.agent_jobs(id,type,project_id,user_id,organization_id,payload)
      VALUES ($1,'publish',$2,$3,$4,'{"publication_snapshot_id":"snapshot"}')`, [id, PROJECT, USER, ORG]);
    expect((await rows('SELECT queue_version,max_attempts,status FROM public.agent_jobs WHERE id=$1', [id]))[0])
      .toEqual({ queue_version: 2, max_attempts: 1, status: 'pending' });
    const [job] = await claim();
    expect(job).toMatchObject({ id, status: 'processing', attempts: 1, max_attempts: 1, payload: { publication_snapshot_id: 'snapshot' } });
    expect(job.lease_token).toMatch(/^[0-9a-f-]{36}$/); expect(job.lease_owner).toBe('worker-a');
    await expect(db.query(`UPDATE public.agent_jobs SET max_attempts=2 WHERE id=$1`, [id])).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps legacy publication rows without snapshots in their original mode', async () => {
    await db.query(`INSERT INTO public.agent_jobs(id,type,project_id,user_id,organization_id,payload)
      VALUES ('job_legacy_publish','publish',$1,$2,$3,'{}')`, [PROJECT, USER, ORG]);
    expect((await rows("SELECT queue_version,max_attempts FROM public.agent_jobs WHERE id='job_legacy_publish'"))[0])
      .toEqual({ queue_version: 1, max_attempts: 3 });
    expect(await claim()).toEqual([]);
  });

  it('deduplicates same-key requests, rejects changed payloads, and enforces one active publish per project', async () => {
    const first = await enqueue({ key: 'same' });
    expect((await enqueue({ key: 'same' })).id).toBe(first.id);
    await expect(enqueue({ key: 'same', payload: { publication_snapshot_id: 'different' } })).rejects.toMatchObject({ code: '22023' });
    await expect(enqueue({ key: 'other' })).rejects.toMatchObject({ code: '23505' });
    await expect(enqueue({ key: 'same', user: OTHER })).rejects.toMatchObject({ code: '23505' });
    expect((await rows(`SELECT count(*)::integer AS count FROM public.agent_jobs`))[0].count).toBe(1);
  });

  it('deduplicates concurrent enqueue requests and lets only one project publication win', async () => {
    const same = await Promise.all(Array.from({ length: 5 }, () => enqueue({ key: 'same' })));
    expect(new Set(same.map(job => job.id)).size).toBe(1);
    // PGlite serializes connections; this still executes the real uniqueness and
    // ON CONFLICT contracts, but is not a multi-backend lock contention test.
    const otherProject = randomUUID();
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => enqueue({ key: `key-${i}`, project: otherProject })));
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('claims highest priorities first, only registered types, and never reclaims processing jobs on restart', async () => {
    const low = await enqueue({ type: 'generate', priority: 'low' });
    const high = await enqueue({ type: 'generate', priority: 'high' });
    const critical = await enqueue({ type: 'generate', priority: 'critical' });
    await enqueue();
    expect((await claim(['generate']))[0].id).toBe(critical.id);
    expect((await claim(['generate']))[0].id).toBe(high.id);
    expect((await claim(['generate']))[0].id).toBe(low.id);
    expect(await rows(`SELECT * FROM public.claim_agent_jobs('restarted-worker',3,60,ARRAY['generate'])`)).toEqual([]);
    expect((await rows(`SELECT attempts FROM public.agent_jobs WHERE type='generate'`)).map(job => job.attempts)).toEqual([1, 1, 1]);
  });

  it('increments attempts exactly once per claim and caps explicit non-publish retries', async () => {
    await enqueue({ type: 'generate', max: 3 });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const [job] = await claim(['generate']); expect(job.attempts).toBe(attempt);
      const [finished] = await finish(job, 'failed', true);
      expect(finished.status).toBe(attempt < 3 ? 'pending' : 'failed');
      expect(finished.attempts).toBe(attempt);
    }
    expect(await claim(['generate'])).toEqual([]);
  });

  it('fences renewal, progress and completion with the current unexpired lease token', async () => {
    await enqueue(); const [job] = await claim(); const wrong = randomUUID();
    expect((await rows(`SELECT public.renew_agent_job_lease($1,$2,120) AS renewed`, [job.id, wrong]))[0].renewed).toBe(false);
    await expect(rows(`SELECT * FROM public.append_agent_job_event($1,$2,'upload','done')`, [job.id, wrong])).rejects.toMatchObject({ code: '55000' });
    expect(await finish({ ...job, lease_token: wrong })).toEqual([]);
    expect((await rows(`SELECT public.renew_agent_job_lease($1,$2,120) AS renewed`, [job.id, job.lease_token]))[0].renewed).toBe(true);
    const [renewed] = await rows(`SELECT lease_expires_at FROM public.agent_jobs WHERE id=$1`, [job.id]);
    expect(new Date(renewed.lease_expires_at).getTime()).toBeGreaterThan(new Date(job.lease_expires_at).getTime());
    await db.query(`UPDATE public.agent_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [job.id]);
    expect((await rows(`SELECT public.renew_agent_job_lease($1,$2,60) AS renewed`, [job.id, job.lease_token]))[0].renewed).toBe(false);
    expect(await finish(job)).toEqual([]);
    await expect(rows(`SELECT * FROM public.append_agent_job_event($1,$2,'upload','late')`, [job.id, job.lease_token])).rejects.toMatchObject({ code: '55000' });
  });

  it('allocates ordered per-job event sequences through completion, including direct legacy inserts', async () => {
    const queued = await enqueue(); const [job] = await claim();
    await Promise.all(['one', 'two', 'three'].map(step => rows(`SELECT * FROM public.append_agent_job_event($1,$2,$3,'progress')`, [job.id, job.lease_token, step])));
    await finish(job);
    const events = await rows(`SELECT step,sequence::integer FROM public.agent_job_events WHERE job_id=$1 ORDER BY sequence`, [queued.id]);
    expect(events.map(event => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.map(event => event.step)).toEqual(['queued', 'processing', 'one', 'two', 'three', 'completed']);
    await db.query(`INSERT INTO public.agent_job_events(job_id,step,message,sequence) VALUES ($1,'legacy','event',1)`, [job.id]);
    expect((await rows(`SELECT max(sequence)::integer AS sequence FROM public.agent_job_events WHERE job_id=$1`, [job.id]))[0].sequence).toBe(7);
  });

  it('reconciles expired processing leases without retry, retaining the publish lock and idempotency tombstone', async () => {
    const queued = await enqueue({ key: 'request-1' }); const [job] = await claim();
    await db.query(`UPDATE public.agent_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [job.id]);
    expect((await rows(`SELECT public.reconcile_expired_agent_jobs() AS count`))[0].count).toBe(1);
    const [failed] = await rows(`SELECT * FROM public.agent_jobs WHERE id=$1`, [job.id]);
    expect(failed).toMatchObject({ status: 'failed', reconciliation_required: true, attempts: 1, lease_token: null });
    expect(await claim()).toEqual([]); expect(await finish(job)).toEqual([]);
    expect((await enqueue({ key: 'request-1' })).id).toBe(queued.id);
    await expect(enqueue({ key: 'request-2' })).rejects.toMatchObject({ code: '23505' });
    expect((await rows(`SELECT public.reconcile_expired_agent_jobs() AS count`))[0].count).toBe(0);
  });

  it('cannot request automatic publication retry even with p_retry=true', async () => {
    await enqueue({ max: 50 }); const [job] = await claim();
    expect(job.max_attempts).toBe(1);
    expect((await finish(job, 'failed', true))[0]).toMatchObject({ status: 'failed', attempts: 1, reconciliation_required: true });
    expect(await claim()).toEqual([]);
  });

  it('expires unstarted jobs without falsely requiring provider reconciliation', async () => {
    const job = await enqueue();
    await db.query(`UPDATE public.agent_jobs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [job.id]);
    await rows(`SELECT public.reconcile_expired_agent_jobs()`);
    expect((await rows(`SELECT status,attempts,reconciliation_required FROM public.agent_jobs WHERE id=$1`, [job.id]))[0])
      .toEqual({ status: 'failed', attempts: 0, reconciliation_required: false });
    expect(await claim()).toEqual([]);
    await expect(enqueue()).resolves.toBeDefined();
  });

  it('allows only owner cancellation before claim and blocks cancellation after processing starts', async () => {
    const pending = await enqueue();
    expect((await rows(`SELECT public.cancel_agent_job($1,$2) AS cancelled`, [pending.id, OTHER]))[0].cancelled).toBe(false);
    expect((await rows(`SELECT public.cancel_agent_job($1,$2) AS cancelled`, [pending.id, USER]))[0].cancelled).toBe(true);
    await enqueue(); const [processing] = await claim();
    expect((await rows(`SELECT public.cancel_agent_job($1,$2) AS cancelled`, [processing.id, USER]))[0].cancelled).toBe(false);
    await expect(db.query(`UPDATE public.agent_jobs SET status='cancelled',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL WHERE id=$1`, [processing.id])).rejects.toMatchObject({ code: '23514' });
  });

  it('retains durable results and idempotency after legacy cleanup', async () => {
    await enqueue({ key: 'retained' }); const [job] = await claim(); await finish(job);
    await db.query(`UPDATE public.agent_jobs SET completed_at=now()-interval '3 hours' WHERE id=$1`, [job.id]);
    await db.query(`INSERT INTO public.agent_jobs(id,type,project_id,user_id,organization_id,status,completed_at)
      VALUES ('job_legacy','generate',$1,$2,$3,'completed',now()-interval '3 hours')`, [PROJECT, USER, ORG]);
    await rows(`SELECT public.cleanup_expired_jobs()`);
    expect((await rows(`SELECT id FROM public.agent_jobs`)).map(row => row.id)).toEqual([job.id]);
    expect((await enqueue({ key: 'retained' })).id).toBe(job.id);
  });

  it('restricts every worker RPC to service_role and keeps invoker security and RLS', async () => {
    const functions = await rows(`SELECT p.oid,p.proname,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('enqueue_agent_job','claim_agent_jobs','renew_agent_job_lease',
      'append_agent_job_event','finish_agent_job','reconcile_expired_agent_jobs','cancel_agent_job','cleanup_expired_jobs',
      'resume_publish_job','authorize_agent_job_lease')`);
    expect(functions).toHaveLength(10);
    for (const fn of functions) {
      expect(fn.prosecdef).toBe(false); expect(fn.proconfig).toContain('search_path=""');
      const [privileges] = await rows(`SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,
        has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated, has_function_privilege('service_role',$1,'EXECUTE') AS service`, [fn.oid]);
      expect(privileges).toEqual({ anon: false, authenticated: false, service: true });
    }
    expect((await rows(`SELECT relrowsecurity FROM pg_class WHERE oid IN ('public.agent_jobs'::regclass,'public.agent_job_events'::regclass)`)).every(row => row.relrowsecurity)).toBe(true);
  });

  it('enforces owner RLS and prevents authenticated lease/payload mutations and processing cancellation', async () => {
    await enqueue(); const [processing] = await claim();
    await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [OTHER]); await db.exec('SET ROLE authenticated');
    expect(await rows(`SELECT id FROM public.agent_jobs`)).toEqual([]);
    expect(await rows(`SELECT id FROM public.agent_job_events`)).toEqual([]);
    await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [USER]);
    expect(await rows(`SELECT id FROM public.agent_jobs`)).toHaveLength(1);
    await expect(db.query(`UPDATE public.agent_jobs SET payload='{}' WHERE id=$1`, [processing.id])).rejects.toMatchObject({ code: '42501' });
    expect(await rows(`UPDATE public.agent_jobs SET status='cancelled' WHERE id=$1 RETURNING id`, [processing.id])).toEqual([]);
    await expect(rows(`SELECT * FROM public.claim_agent_jobs('browser',1,60,ARRAY['publish'])`)).rejects.toMatchObject({ code: '42501' });
  });

  it('explicitly resumes the same failed publication and preserves immutable identity and failure audit', async () => {
    const queued = await enqueue({ key: 'same-snapshot' }); const [claimed] = await claim();
    await rows(`SELECT * FROM public.finish_agent_job($1,$2,'failed',NULL,'Prior provider outcome uncertain',false,true)`, [claimed.id, claimed.lease_token]);
    await db.query(`UPDATE public.agent_jobs SET result='{"provider_deployment_id":"existing"}',
      expires_at=clock_timestamp()-interval '1 day' WHERE id=$1`, [queued.id]);
    const [previous] = await rows('SELECT * FROM public.agent_jobs WHERE id=$1', [queued.id]);
    expect(await resume(queued.id, OTHER)).toEqual([]);
    const [resumed] = await resume(queued.id);
    expect(resumed).toMatchObject({ id: queued.id, queue_version: 2, status: 'pending', reconciliation_required: false,
      attempts: 0, max_attempts: 1, resume_count: 1, lease_token: null, lease_owner: null, lease_expires_at: null,
      payload: queued.payload, project_id: PROJECT, user_id: USER, organization_id: ORG, idempotency_key: 'same-snapshot',
      started_at: null, completed_at: null, result: null, error: null });
    expect(resumed.created_at).toEqual(queued.created_at);
    expect(resumed.last_resumed_at).toBeTruthy();
    expect(new Date(resumed.expires_at).getTime()).toBeGreaterThan(Date.now());
    const events = await rows('SELECT * FROM public.agent_job_events WHERE job_id=$1 ORDER BY sequence', [queued.id]);
    expect(events.map(event => event.step)).toEqual(['queued', 'processing', 'failed', 'resume_requested']);
    expect(events[3].metadata).toMatchObject({ requested_by: USER, resume_count: 1, previous_attempts: 1,
      previous_error: previous.error, previous_result: { provider_deployment_id: 'existing' } });
    expect(JSON.stringify(events[3].metadata)).not.toContain(claimed.lease_token);
    expect((await enqueue({ key: 'same-snapshot' })).id).toBe(queued.id);
    await expect(enqueue({ key: 'new-job' })).rejects.toMatchObject({ code: '23505' });
    expect((await rows('SELECT count(*)::integer AS count FROM public.agent_jobs'))[0].count).toBe(1);
  });

  it('permits at most three explicit resumes, with one execution per resume and no fourth retry', async () => {
    const queued = await enqueue({ key: 'bounded' }); let [current] = await claim(); await finish(current, 'failed');
    for (let count = 1; count <= 3; count++) {
      const [resumed] = await resume(queued.id);
      expect(resumed).toMatchObject({ id: queued.id, attempts: 0, resume_count: count, max_attempts: 1 });
      [current] = await claim();
      expect(current).toMatchObject({ attempts: 1, resume_count: count, max_attempts: 1 });
      expect(await claim()).toEqual([]);
      await finish(current, 'failed', true);
      expect(await claim()).toEqual([]);
    }
    expect(await resume(queued.id)).toEqual([]);
    expect((await rows('SELECT status,resume_count,reconciliation_required FROM public.agent_jobs WHERE id=$1', [queued.id]))[0])
      .toEqual({ status: 'failed', resume_count: 3, reconciliation_required: true });
    const events = await rows('SELECT step,metadata FROM public.agent_job_events WHERE job_id=$1 ORDER BY sequence', [queued.id]);
    expect(events.filter(event => event.step === 'processing')).toHaveLength(4);
    expect(events.filter(event => event.step === 'resume_requested').map(event => event.metadata.resume_count)).toEqual([1, 2, 3]);
    await expect(db.query('UPDATE public.agent_jobs SET resume_count=4 WHERE id=$1', [queued.id])).rejects.toMatchObject({ code: '23514' });
    await expect(enqueue({ key: 'cannot-bypass-limit' })).rejects.toMatchObject({ code: '23505' });
  });

  it('resumes only failed unreconciled durable publications without a lease', async () => {
    const queued = await enqueue(); expect(await resume(queued.id)).toEqual([]);
    const [processing] = await claim(); expect(await resume(queued.id)).toEqual([]);
    await finish(processing); expect(await resume(queued.id)).toEqual([]);
    const cancelled = await enqueue(); await rows('SELECT public.cancel_agent_job($1,$2)', [cancelled.id, USER]);
    expect(await resume(cancelled.id)).toEqual([]);
    const expired = await enqueue();
    await db.query("UPDATE public.agent_jobs SET expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1", [expired.id]);
    await rows('SELECT public.reconcile_expired_agent_jobs()');
    expect(await resume(expired.id)).toEqual([]);
    const generic = await enqueue({ type: 'generate' }); const [generated] = await claim(['generate']);
    await rows(`SELECT * FROM public.finish_agent_job($1,$2,'failed',NULL,NULL,false,true)`, [generic.id, generated.lease_token]);
    expect(await resume(generic.id)).toEqual([]);
    await db.query(`INSERT INTO public.agent_jobs(id,type,project_id,user_id,organization_id,status,reconciliation_required)
      VALUES ('job_legacy_failed','publish',$1,$2,$3,'failed',true)`, [PROJECT, USER, ORG]);
    expect(await resume('job_legacy_failed')).toEqual([]);
    expect(await resume('missing')).toEqual([]);
  });

  it('allows only one concurrent explicit resume to transition a failed job', async () => {
    await enqueue(); const [claimed] = await claim(); await finish(claimed, 'failed');
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => resume(claimed.id)));
    expect(outcomes.filter(result => result.length === 1)).toHaveLength(1);
    expect((await rows('SELECT resume_count FROM public.agent_jobs WHERE id=$1', [claimed.id]))[0].resume_count).toBe(1);
    expect((await rows("SELECT count(*)::integer AS count FROM public.agent_job_events WHERE job_id=$1 AND step='resume_requested'", [claimed.id]))[0].count).toBe(1);
  });

  it('authorizes only the current lease and permanently fences a pre-resume token', async () => {
    const queued = await enqueue();
    const authorized = async (token: string) => (await rows('SELECT public.authorize_agent_job_lease($1,$2) AS authorized', [queued.id, token]))[0].authorized;
    expect(await authorized(randomUUID())).toBe(false);
    const [originalClaim] = await claim(); expect(await authorized(originalClaim.lease_token)).toBe(true);
    const [before] = await rows('SELECT lease_expires_at FROM public.agent_jobs WHERE id=$1', [queued.id]);
    await authorized(originalClaim.lease_token);
    expect((await rows('SELECT lease_expires_at FROM public.agent_jobs WHERE id=$1', [queued.id]))[0]).toEqual(before);
    await db.query("UPDATE public.agent_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [queued.id]);
    expect(await authorized(originalClaim.lease_token)).toBe(false);
    await rows('SELECT public.reconcile_expired_agent_jobs()'); await resume(queued.id);
    expect(await authorized(originalClaim.lease_token)).toBe(false);
    const [newClaim] = await claim(); expect(newClaim.lease_token).not.toBe(originalClaim.lease_token);
    expect(await authorized(originalClaim.lease_token)).toBe(false); expect(await authorized(newClaim.lease_token)).toBe(true);
    expect(await finish(originalClaim)).toEqual([]);
    await expect(rows("SELECT * FROM public.append_agent_job_event($1,$2,'stale','must not persist')", [queued.id, originalClaim.lease_token])).rejects.toMatchObject({ code: '55000' });
    await finish(newClaim); expect(await authorized(newClaim.lease_token)).toBe(false);
  });

  it('rolls back the whole resume and its budget consumption if the audit event fails', async () => {
    await enqueue(); const [claimed] = await claim(); await finish(claimed, 'failed');
    const [before] = await rows('SELECT * FROM public.agent_jobs WHERE id=$1', [claimed.id]);
    await db.exec('RESET ROLE; ALTER TABLE public.agent_job_events ADD CONSTRAINT test_no_resume CHECK (step <> \'resume_requested\'); SET ROLE service_role;');
    try {
      await expect(resume(claimed.id)).rejects.toMatchObject({ code: '23514' });
      expect((await rows('SELECT * FROM public.agent_jobs WHERE id=$1', [claimed.id]))[0]).toEqual(before);
    } finally {
      await db.exec('RESET ROLE; ALTER TABLE public.agent_job_events DROP CONSTRAINT test_no_resume; SET ROLE service_role;');
    }
    expect((await resume(claimed.id))[0].resume_count).toBe(1);
  });

  it('never cleans up uncertain or snapshot-backed jobs, including compatibility rows', async () => {
    await enqueue({ key: 'keep-uncertain' }); const [claimed] = await claim(); await finish(claimed, 'failed');
    await db.query("UPDATE public.agent_jobs SET completed_at=now()-interval '3 hours',expires_at=now()-interval '1 hour' WHERE id=$1", [claimed.id]);
    await db.query(`INSERT INTO public.agent_jobs(id,type,project_id,user_id,organization_id,status,completed_at,reconciliation_required,payload)
      VALUES ('job_legacy_uncertain','generate',$1,$2,$3,'failed',now()-interval '3 hours',true,'{}'),
      ('job_legacy_snapshot','generate',$1,$2,$3,'failed',now()-interval '3 hours',false,'{"publication_snapshot_id":"old-snapshot"}'),
      ('job_legacy_expired','generate',$1,$2,$3,'failed',now()-interval '3 hours',false,'{}')`, [PROJECT, USER, ORG]);
    // Represents a pre-promotion compatibility row, not a normal V2 insert.
    await db.exec("UPDATE public.agent_jobs SET type='publish' WHERE id='job_legacy_snapshot'");
    const eventCount = (await rows('SELECT count(*)::integer AS count FROM public.agent_job_events WHERE job_id=$1', [claimed.id]))[0].count;
    await rows('SELECT public.cleanup_expired_jobs()');
    expect(new Set((await rows('SELECT id FROM public.agent_jobs')).map(row => row.id)))
      .toEqual(new Set([claimed.id, 'job_legacy_uncertain', 'job_legacy_snapshot']));
    expect((await rows('SELECT count(*)::integer AS count FROM public.agent_job_events WHERE job_id=$1', [claimed.id]))[0].count).toBe(eventCount);
    expect((await enqueue({ key: 'keep-uncertain' })).id).toBe(claimed.id);
  });

  it('rolls back enqueue, claim and completion when their lifecycle event cannot persist', async () => {
    await db.exec('RESET ROLE; ALTER TABLE public.agent_job_events ADD CONSTRAINT test_no_queued CHECK (step <> \'queued\'); SET ROLE service_role;');
    try {
      await expect(enqueue()).rejects.toMatchObject({ code: '23514' });
      expect(await rows('SELECT id FROM public.agent_jobs')).toEqual([]);
    } finally {
      await db.exec('RESET ROLE; ALTER TABLE public.agent_job_events DROP CONSTRAINT test_no_queued; SET ROLE service_role;');
    }
    const queued = await enqueue();
    await db.exec('RESET ROLE; ALTER TABLE public.agent_job_events ADD CONSTRAINT test_no_processing CHECK (step <> \'processing\'); SET ROLE service_role;');
    try {
      await expect(claim()).rejects.toMatchObject({ code: '23514' });
      expect((await rows('SELECT status,attempts,lease_token,event_sequence::integer FROM public.agent_jobs'))[0])
        .toEqual({ status: 'pending', attempts: 0, lease_token: null, event_sequence: 1 });
    } finally {
      await db.exec('RESET ROLE; ALTER TABLE public.agent_job_events DROP CONSTRAINT test_no_processing; SET ROLE service_role;');
    }
    const [claimed] = await claim();
    await db.exec('RESET ROLE; ALTER TABLE public.agent_job_events ADD CONSTRAINT test_no_completed CHECK (step <> \'completed\'); SET ROLE service_role;');
    try {
      await expect(finish(claimed)).rejects.toMatchObject({ code: '23514' });
      expect((await rows('SELECT id,status,attempts,lease_token,event_sequence::integer FROM public.agent_jobs'))[0])
        .toEqual({ id: queued.id, status: 'processing', attempts: 1, lease_token: claimed.lease_token, event_sequence: 2 });
    } finally {
      await db.exec('RESET ROLE; ALTER TABLE public.agent_job_events DROP CONSTRAINT test_no_completed; SET ROLE service_role;');
    }
  });
});
