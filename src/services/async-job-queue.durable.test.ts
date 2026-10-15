import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authorizeJobLease, cancelJob, enqueueJob, getJobForUser, getJobStatus, initJobQueue, isDurableJobQueueEnabled, resumePublishJob,
  listJobEvents, registerJobHandler, runJobWorkerOnce, startJobWorker, stopJobWorker,
  type CodenJob, type JobHandler, type JobExecutionContext,
} from './async-job-queue.ts';

const input = { type: 'publish' as const, project_id: 'project', user_id: 'user', organization_id: 'org', payload: { revision: 'approved' } };
const job = (overrides: Partial<CodenJob> = {}): CodenJob => ({
  ...input, id: 'durable-job-test', queue_version: 2, status: 'processing', priority: 'normal',
  attempts: 1, max_attempts: 1, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 1800000).toISOString(),
  lease_token: 'lease-secret', lease_owner: 'worker', lease_expires_at: new Date(Date.now() + 60000).toISOString(), ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function query(result: unknown = { data: [], error: null }) {
  const builder: any = { then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject) };
  for (const method of ['select', 'eq', 'not', 'or', 'gt', 'lt', 'order', 'limit', 'insert', 'update', 'in']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => builder);
  return builder;
}

function clientFor(claims: CodenJob[] = []) {
  let claimed = false;
  const client = {
    from: vi.fn((_name: string) => query()),
    rpc: vi.fn(async (name: string, args: any = {}): Promise<any> => {
      if (name === 'claim_agent_jobs') {
        if (claimed) return { data: [], error: null };
        claimed = true;
        return { data: claims, error: null };
      }
      if (name === 'enqueue_agent_job') return { data: [{ id: args.p_id }], error: null };
      if (name === 'append_agent_job_event') return { data: [{ id: 'event', sequence: 1 }], error: null };
      if (name === 'finish_agent_job') return { data: [job({ status: args.p_outcome })], error: null };
      return { data: name === 'reconcile_expired_agent_jobs' ? 0 : true, error: null };
    }),
  };
  return client;
}

beforeEach(() => {
  vi.stubEnv('CODEN_PUBLICATION_V2', '0');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  stopJobWorker();
  initJobQueue(null, { durable: false });
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('durable queue opt-in and public APIs', () => {
  it('keeps legacy inserts, job IDs and retry defaults when the feature is disabled', async () => {
    const builder = query({ error: null });
    const client = clientFor(); client.from.mockReturnValue(builder);
    initJobQueue(client);
    expect(isDurableJobQueueEnabled()).toBe(false);
    await expect(enqueueJob(input)).resolves.toMatch(/^job_/);
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ max_attempts: 3 }));
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('supports the CODEN_PUBLICATION_V2 feature flag', () => {
    vi.stubEnv('CODEN_PUBLICATION_V2', '1'); initJobQueue(clientFor());
    expect(isDurableJobQueueEnabled()).toBe(true);
  });

  it('fails closed without a database instead of executing publication in memory', async () => {
    const handler = vi.fn(async () => ({})); registerJobHandler('publish', handler);
    initJobQueue(null, { durable: true });
    await expect(enqueueJob(input)).rejects.toThrow('requires database');
    expect(handler).not.toHaveBeenCalled();
  });

  it('uses transactional enqueue with explicit publication max_attempts=1 and an optional idempotency key', async () => {
    const client = clientFor(); initJobQueue(client, { durable: true });
    await expect(enqueueJob({ ...input, max_attempts: 99, idempotency_key: 'revision-1' })).resolves.toMatch(/^durable-job-/);
    expect(client.rpc).toHaveBeenCalledWith('enqueue_agent_job', expect.objectContaining({ p_max_attempts: 1, p_idempotency_key: 'revision-1' }));
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(['', ' ', 'x'.repeat(201)])('rejects invalid idempotency keys before persistence', async key => {
    const client = clientFor(); initJobQueue(client, { durable: true });
    await expect(enqueueJob({ ...input, idempotency_key: key })).rejects.toThrow('idempotency');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('rejects resolved SQL errors and missing acknowledgements', async () => {
    const client = clientFor(); initJobQueue(client, { durable: true });
    client.rpc.mockResolvedValueOnce({ error: { code: '23505', message: 'private SQL' } });
    await expect(enqueueJob(input)).rejects.toMatchObject({ code: '23505', diagnosticCode: 'DATABASE_PERSISTENCE_FAILED' });
    client.rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(enqueueJob(input)).rejects.toThrow('not acknowledged');
  });

  it('requires owner scope and never returns lease credentials or idempotency keys', async () => {
    const builder = query({ data: job({ idempotency_key: 'private' }), error: null });
    const client = clientFor(); client.from.mockReturnValue(builder); initJobQueue(client, { durable: true });
    const result = await getJobForUser('durable-job-test', { user_id: 'user', organization_id: 'org', project_id: 'project' });
    expect(builder.eq.mock.calls).toEqual([['id', 'durable-job-test'], ['user_id', 'user'], ['organization_id', 'org'], ['project_id', 'project']]);
    expect(result).not.toHaveProperty('lease_token'); expect(result).not.toHaveProperty('lease_owner'); expect(result).not.toHaveProperty('idempotency_key');
    await expect(getJobForUser('id', { user_id: '' })).rejects.toThrow('owner');
  });

  it('checks ownership before event access and paginates by sequence, not timestamps', async () => {
    const parent = query({ data: job(), error: null });
    const events = query({ data: [{ sequence: 4 }], error: null });
    const client = clientFor(); client.from.mockImplementation(name => name === 'agent_jobs' ? parent : events);
    initJobQueue(client, { durable: true });
    expect(await listJobEvents('id', { user_id: 'user' }, { afterSequence: 3, limit: 20 })).toEqual([{ sequence: 4 }]);
    expect(events.gt).toHaveBeenCalledWith('sequence', 3);
    expect(events.order).toHaveBeenCalledWith('sequence', { ascending: true });
    client.from.mockReturnValue(query({ data: null, error: null })); client.from.mockClear();
    expect(await listJobEvents('id', { user_id: 'other' })).toEqual([]);
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it('surfaces retrieval/event errors instead of returning false missing/completed states', async () => {
    const client = clientFor(); initJobQueue(client, { durable: true });
    client.from.mockReturnValue(query({ error: { code: '08006' } }));
    await expect(getJobStatus('id')).rejects.toThrow('retrieve job');
    client.from.mockReturnValueOnce(query({ data: job(), error: null })).mockReturnValueOnce(query({ error: { code: '08006' } }));
    await expect(listJobEvents('id', { user_id: 'user' })).rejects.toThrow('list job events');
  });

  it('uses an owner-checked atomic cancel and returns false for processing/missing jobs', async () => {
    const client = clientFor(); initJobQueue(client, { durable: true });
    client.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await cancelJob('durable-job-test', 'user')).toBe(false);
    expect(client.rpc).toHaveBeenCalledWith('cancel_agent_job', { p_job_id: 'durable-job-test', p_user_id: 'user' });
    client.rpc.mockResolvedValueOnce({ error: { code: '08006' } });
    await expect(cancelJob('durable-job-test', 'user')).rejects.toThrow('cancel durable job');
  });

  it('uses durable cancellation for publication jobs created with normal IDs', async () => {
    const client = clientFor(); initJobQueue(client, { durable: true });
    client.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await cancelJob('job_snapshot', 'user')).toBe(false);
    expect(client.rpc).toHaveBeenCalledWith('cancel_agent_job', { p_job_id: 'job_snapshot', p_user_id: 'user' });
  });

  it('excludes snapshot-backed publish jobs from legacy polling even when disabled', async () => {
    const builder = query(); const client = clientFor(); client.from.mockReturnValue(builder);
    initJobQueue(client, { durable: false }); await runJobWorkerOnce();
    expect(builder.or).toHaveBeenCalledWith('type.neq.publish,payload->>publication_snapshot_id.is.null');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('explicitly resumes the same publication through an owner-scoped RPC without exposing credentials', async () => {
    const client = clientFor(); initJobQueue(client, { durable: true });
    client.rpc.mockResolvedValueOnce({ data: [job({ status: 'pending', attempts: 0, resume_count: 1, idempotency_key: 'private' })], error: null });
    const resumed = await resumePublishJob('durable-job-test', 'user');
    expect(client.rpc).toHaveBeenCalledWith('resume_publish_job', { p_job_id: 'durable-job-test', p_user_id: 'user' });
    expect(resumed).toMatchObject({ id: 'durable-job-test', status: 'pending', resume_count: 1, payload: input.payload });
    expect(resumed).not.toHaveProperty('lease_token'); expect(resumed).not.toHaveProperty('idempotency_key');
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('returns null for ineligible resumes but rejects durable SQL failures', async () => {
    const client = clientFor(); initJobQueue(client, { durable: true });
    client.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await resumePublishJob('job_test', 'user')).toBeNull();
    client.rpc.mockResolvedValueOnce({ error: { code: '08006', message: 'private SQL' } });
    await expect(resumePublishJob('job_test', 'user')).rejects.toMatchObject({ code: '08006', diagnosticCode: 'DATABASE_PERSISTENCE_FAILED' });
  });

  it('requires durable mode, persistence and an owner before resume', async () => {
    const client = clientFor(); initJobQueue(client, { durable: false });
    await expect(resumePublishJob('job_test', 'user')).rejects.toThrow('not enabled');
    initJobQueue(null, { durable: true });
    await expect(resumePublishJob('job_test', 'user')).rejects.toThrow('requires database');
    initJobQueue(client, { durable: true });
    await expect(resumePublishJob('job_test', '')).rejects.toThrow('owner');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('authorizes only a current lease and distinguishes rejection from database failure', async () => {
    const client = clientFor(); initJobQueue(client, { durable: true });
    client.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    expect(await authorizeJobLease('job_test', 'token')).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith('authorize_agent_job_lease', { p_job_id: 'job_test', p_lease_token: 'token' });
    expect(await authorizeJobLease('job_test', 'old-token')).toBe(false);
    client.rpc.mockResolvedValueOnce({ error: { code: '08006' } });
    await expect(authorizeJobLease('job_test', 'token')).rejects.toThrow('authorize job lease');
    client.rpc.mockClear(); expect(await authorizeJobLease('job_test', '')).toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe('durable worker claims, fencing and persistence', () => {
  it('claims atomically via RPC, preserves claim attempts and does not duplicate overlapping polls', async () => {
    const done = deferred<Record<string, unknown>>(); const handler = vi.fn<JobHandler>(() => done.promise);
    const client = clientFor([job({ attempts: 2, type: 'generate', max_attempts: 3 })]);
    registerJobHandler('generate', handler); initJobQueue(client, { durable: true });
    const pass = runJobWorkerOnce(); await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await runJobWorkerOnce();
    expect(handler.mock.calls[0][0].attempts).toBe(2);
    expect(client.rpc).toHaveBeenCalledWith('claim_agent_jobs', expect.objectContaining({ p_limit: 3, p_types: expect.arrayContaining(['generate']) }));
    done.resolve({ ok: true }); await pass;
    expect(handler).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('finish_agent_job', expect.objectContaining({ p_outcome: 'completed', p_lease_token: 'lease-secret' }));
  });

  it('does not call a provider when ownership cannot be confirmed', async () => {
    const client = clientFor([job()]); const rpc = client.rpc.getMockImplementation()!;
    client.rpc.mockImplementation((name, args) => name === 'renew_agent_job_lease' ? Promise.resolve({ data: false, error: null }) : rpc(name, args));
    const handler = vi.fn(async () => ({})); registerJobHandler('publish', handler); initJobQueue(client, { durable: true });
    await expect(runJobWorkerOnce()).rejects.toThrow('lease lost');
    expect(handler).not.toHaveBeenCalled();
    expect(client.rpc.mock.calls.some(([name]) => name === 'finish_agent_job')).toBe(false);
  });

  it('serializes progress and flushes unawaited legacy-style callbacks before completion', async () => {
    const event = deferred<any>(); const client = clientFor([job()]); const rpc = client.rpc.getMockImplementation()!;
    let inserts = 0;
    client.rpc.mockImplementation((name, args) => name === 'append_agent_job_event' && ++inserts === 1 ? event.promise : rpc(name, args));
    registerJobHandler('publish', async (_job, progress) => { void progress!('one', 'first'); void progress!('two', 'second'); return { url: 'https://example.test' }; });
    initJobQueue(client, { durable: true }); const pass = runJobWorkerOnce();
    await vi.waitFor(() => expect(inserts).toBe(1));
    expect(client.rpc.mock.calls.some(([name]) => name === 'finish_agent_job')).toBe(false);
    event.resolve({ data: [{ id: 'event-1' }], error: null }); await pass;
    expect(inserts).toBe(2);
    const order = client.rpc.mock.calls.map(([name]) => name);
    expect(order.lastIndexOf('append_agent_job_event')).toBeLessThan(order.indexOf('finish_agent_job'));
  });

  it('surfaces a progress SQL failure even if the handler ignored the callback promise', async () => {
    const client = clientFor([job()]); const rpc = client.rpc.getMockImplementation()!;
    client.rpc.mockImplementation((name, args) => name === 'append_agent_job_event' ? Promise.resolve({ error: { code: '08006' } }) : rpc(name, args));
    registerJobHandler('publish', async (_job, progress) => { void progress!('upload', 'done'); return {}; });
    initJobQueue(client, { durable: true });
    await expect(runJobWorkerOnce()).rejects.toThrow('append job progress');
    expect(client.rpc).toHaveBeenCalledWith('finish_agent_job', expect.objectContaining({ p_outcome: 'failed', p_retry: false, p_reconciliation_required: true }));
  });

  it('never retries a publication failure and redacts its persisted error', async () => {
    const client = clientFor([job()]); registerJobHandler('publish', async () => { throw new Error('provider token: sbp_123456789012345678901234567890'); });
    initJobQueue(client, { durable: true }); await runJobWorkerOnce();
    expect(client.rpc).toHaveBeenCalledWith('finish_agent_job', expect.objectContaining({ p_retry: false, p_reconciliation_required: true, p_error: 'provider token: [masked-secret]' }));
  });

  it('leaves an uncertain completion leased for reconciliation when final persistence fails', async () => {
    const client = clientFor([job()]); const rpc = client.rpc.getMockImplementation()!; const handler = vi.fn(async () => ({ ok: true }));
    client.rpc.mockImplementation((name, args) => name === 'finish_agent_job' ? Promise.resolve({ error: { code: '08006' } }) : rpc(name, args));
    registerJobHandler('publish', handler); initJobQueue(client, { durable: true });
    await expect(runJobWorkerOnce()).rejects.toThrow('finish durable job'); await runJobWorkerOnce();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(client.rpc.mock.calls.filter(([name]) => name === 'finish_agent_job')).toHaveLength(1);
  });

  it('renews long-running leases and aborts/fences progress on renewal failure', async () => {
    vi.useFakeTimers(); const client = clientFor([job()]); const rpc = client.rpc.getMockImplementation()!;
    let renewals = 0; let signal: AbortSignal | undefined;
    const done = deferred<Record<string, unknown>>();
    client.rpc.mockImplementation((name, args) => name === 'renew_agent_job_lease' && ++renewals > 1 ? Promise.resolve({ data: false, error: null }) : rpc(name, args));
    registerJobHandler('publish', async (_job, _progress, context) => { signal = context!.signal; return done.promise; });
    initJobQueue(client, { durable: true, leaseDurationMs: 10000 });
    const pass = runJobWorkerOnce(); const assertion = expect(pass).rejects.toThrow('lease lost');
    await vi.advanceTimersByTimeAsync(0); expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(3334); expect(signal?.aborted).toBe(true);
    done.resolve({}); await assertion;
    expect(client.rpc.mock.calls.some(([name]) => name === 'finish_agent_job')).toBe(false);
  });

  it('reports background polling errors without leaking database messages', async () => {
    vi.useFakeTimers(); const client = clientFor(); const onError = vi.fn();
    client.rpc.mockResolvedValue({ error: { code: '08006', message: 'private password' } });
    initJobQueue(client, { durable: true, onError }); startJobWorker(); await vi.advanceTimersByTimeAsync(2000);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ diagnosticCode: 'DATABASE_PERSISTENCE_FAILED' }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private password');
  });

  it('continues lease reconciliation when every local slot is occupied', async () => {
    const done = deferred<Record<string, unknown>>(); const handler = vi.fn<JobHandler>(() => done.promise);
    const client = clientFor([job({ id: 'durable-job-1' }), job({ id: 'durable-job-2' }), job({ id: 'durable-job-3' })]);
    registerJobHandler('publish', handler); initJobQueue(client, { durable: true });
    const pass = runJobWorkerOnce(); await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(3));
    const reconciliations = client.rpc.mock.calls.filter(([name]) => name === 'reconcile_expired_agent_jobs').length;
    await runJobWorkerOnce();
    expect(client.rpc.mock.calls.filter(([name]) => name === 'reconcile_expired_agent_jobs')).toHaveLength(reconciliations + 1);
    expect(client.rpc.mock.calls.filter(([name]) => name === 'claim_agent_jobs')).toHaveLength(1);
    done.resolve({}); await pass;
  });

  it('does not lose execution errors if the following legacy poll also fails', async () => {
    const client = clientFor([job()]); const rpc = client.rpc.getMockImplementation()!;
    client.from.mockReturnValue(query({ error: { code: 'legacy_poll_failure' } }));
    client.rpc.mockImplementation((name, args) => name === 'finish_agent_job' ? Promise.resolve({ error: { code: 'finish_failure' } }) : rpc(name, args));
    registerJobHandler('publish', async () => ({})); initJobQueue(client, { durable: true });
    await expect(runJobWorkerOnce()).rejects.toMatchObject({ errors: [expect.objectContaining({ code: 'legacy_poll_failure' }), expect.objectContaining({ code: 'finish_failure' })] });
  });

  it('exposes an awaited provider fence and rejects the saved context after execution ends', async () => {
    const client = clientFor([job()]); let context: JobExecutionContext | undefined;
    const provider = vi.fn(async () => ({}));
    registerJobHandler('publish', async (_job, _progress, ctx) => { context = ctx; await ctx!.assertLease(); return provider(); });
    initJobQueue(client, { durable: true }); await runJobWorkerOnce();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(client.rpc.mock.calls.filter(([name]) => name === 'renew_agent_job_lease')).toHaveLength(2);
    await expect(context!.assertLease()).rejects.toThrow('no longer active');
  });

  it('does not start a provider call when the context fence loses its lease', async () => {
    const client = clientFor([job()]); const rpc = client.rpc.getMockImplementation()!;
    let renewals = 0; const provider = vi.fn(async () => ({})); let signal: AbortSignal | undefined;
    client.rpc.mockImplementation((name, args) => name === 'renew_agent_job_lease' && ++renewals > 1 ? Promise.resolve({ data: false, error: null }) : rpc(name, args));
    registerJobHandler('publish', async (_job, _progress, ctx) => { signal = ctx!.signal; await ctx!.assertLease(); return provider(); });
    initJobQueue(client, { durable: true }); await expect(runJobWorkerOnce()).rejects.toThrow('lease lost');
    expect(signal?.aborted).toBe(true); expect(provider).not.toHaveBeenCalled();
    expect(client.rpc.mock.calls.some(([name]) => name === 'finish_agent_job')).toBe(false);
  });

  it('never resumes from polling and refuses to requeue underneath an active local handler', async () => {
    const done = deferred<Record<string, unknown>>(); const handler = vi.fn<JobHandler>(() => done.promise);
    const client = clientFor([job()]); registerJobHandler('publish', handler); initJobQueue(client, { durable: true });
    const pass = runJobWorkerOnce(); await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(await resumePublishJob('durable-job-test', 'user')).toBeNull();
    expect(client.rpc.mock.calls.some(([name]) => name === 'resume_publish_job')).toBe(false);
    done.resolve({}); await pass;
  });
});
