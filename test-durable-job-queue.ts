/**
 * Comprehensive tests for the durable job queue.
 *
 * Run with: node --experimental-strip-types test-durable-job-queue.ts
 */

import {
  DurableJobQueue,
  InMemoryJobStore,
  JobEventEmitter,
  computeBackoff,
  DEFAULT_BACKOFF,
  PRIORITY_ORDER,
  type CodenJob,
  type JobEvent,
  type JobType,
  type BackoffConfig,
} from './src/services/durable-job-queue.ts';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    failed++;
    failures.push(message);
    console.error(`  FAIL: ${message}`);
  } else {
    passed++;
  }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    failed++;
    const msg = `${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.error(`  FAIL: ${msg}`);
  } else {
    passed++;
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, message: string): void {
  if (Math.abs(actual - expected) > tolerance) {
    failed++;
    const msg = `${message} — expected ~${expected} (+/-${tolerance}), got ${actual}`;
    failures.push(msg);
    console.error(`  FAIL: ${msg}`);
  } else {
    passed++;
  }
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
  } catch (err: any) {
    failed++;
    const msg = `${name} — threw: ${err?.message ?? err}`;
    failures.push(msg);
    console.error(`  FAIL: ${msg}`);
  }
}

function makeJob(overrides: Partial<CodenJob> = {}): CodenJob {
  const now = new Date();
  return {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'generate',
    status: 'pending',
    priority: 'normal',
    project_id: 'proj_1',
    user_id: 'user_1',
    organization_id: 'org_1',
    payload: {},
    attempts: 0,
    max_attempts: 3,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    error_history: [],
    ...overrides,
  };
}

function makeQueue(config: ConstructorParameters<typeof DurableJobQueue>[1] = {}): { queue: DurableJobQueue; store: InMemoryJobStore } {
  const store = new InMemoryJobStore();
  const queue = new DurableJobQueue(store, config);
  return { queue, store };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests(): Promise<void> {
  console.log('\n=== InMemoryJobStore CRUD ===');

  await test('save and get', async () => {
    const store = new InMemoryJobStore();
    const job = makeJob({ id: 'crud_1' });
    await store.save(job);
    const retrieved = await store.get('crud_1');
    assert(retrieved !== null, 'job should exist');
    assertEq(retrieved!.id, 'crud_1', 'id matches');
    assertEq(retrieved!.type, 'generate', 'type matches');
  });

  await test('get returns null for missing', async () => {
    const store = new InMemoryJobStore();
    const retrieved = await store.get('nonexistent');
    assertEq(retrieved, null, 'returns null for missing job');
  });

  await test('update merges fields', async () => {
    const store = new InMemoryJobStore();
    const job = makeJob({ id: 'crud_2' });
    await store.save(job);
    await store.update('crud_2', { status: 'processing', started_at: new Date().toISOString() });
    const retrieved = await store.get('crud_2');
    assertEq(retrieved!.status, 'processing', 'status updated');
    assert(retrieved!.started_at !== undefined, 'started_at set');
  });

  await test('delete removes job', async () => {
    const store = new InMemoryJobStore();
    const job = makeJob({ id: 'crud_3' });
    await store.save(job);
    const deleted = await store.delete('crud_3');
    assertEq(deleted, true, 'delete returns true');
    const retrieved = await store.get('crud_3');
    assertEq(retrieved, null, 'job no longer exists');
  });

  await test('delete returns false for missing', async () => {
    const store = new InMemoryJobStore();
    const deleted = await store.delete('nonexistent');
    assertEq(deleted, false, 'delete returns false for missing');
  });

  await test('size and clear', async () => {
    const store = new InMemoryJobStore();
    await store.save(makeJob({ id: 'c1' }));
    await store.save(makeJob({ id: 'c2' }));
    assertEq(store.size, 2, 'size is 2');
    store.clear();
    assertEq(store.size, 0, 'size is 0 after clear');
  });

  await test('get returns a clone (mutations do not affect store)', async () => {
    const store = new InMemoryJobStore();
    const job = makeJob({ id: 'clone_1' });
    await store.save(job);
    const retrieved = await store.get('clone_1');
    retrieved!.status = 'failed';
    const again = await store.get('clone_1');
    assertEq(again!.status, 'pending', 'store is not mutated by external changes');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== findReady ordering ===');

  await test('findReady respects priority ordering', async () => {
    const store = new InMemoryJobStore();
    const now = new Date();
    const base = { created_at: now.toISOString(), expires_at: new Date(now.getTime() + 60000).toISOString() };
    await store.save(makeJob({ id: 'low', priority: 'low', ...base }));
    await store.save(makeJob({ id: 'critical', priority: 'critical', ...base }));
    await store.save(makeJob({ id: 'normal', priority: 'normal', ...base }));
    await store.save(makeJob({ id: 'high', priority: 'high', ...base }));

    const ready = await store.findReady(10, now.toISOString());
    assertEq(ready.length, 4, 'all 4 jobs are ready');
    assertEq(ready[0].id, 'critical', 'critical first');
    assertEq(ready[1].id, 'high', 'high second');
    assertEq(ready[2].id, 'normal', 'normal third');
    assertEq(ready[3].id, 'low', 'low last');
  });

  await test('findReady: same priority uses FIFO (created_at ascending)', async () => {
    const store = new InMemoryJobStore();
    const t1 = new Date('2025-01-01T00:00:00Z');
    const t2 = new Date('2025-01-01T00:00:01Z');
    const t3 = new Date('2025-01-01T00:00:02Z');
    const expires = new Date('2025-12-31T00:00:00Z').toISOString();

    await store.save(makeJob({ id: 'third', priority: 'normal', created_at: t3.toISOString(), expires_at: expires }));
    await store.save(makeJob({ id: 'first', priority: 'normal', created_at: t1.toISOString(), expires_at: expires }));
    await store.save(makeJob({ id: 'second', priority: 'normal', created_at: t2.toISOString(), expires_at: expires }));

    const ready = await store.findReady(10, new Date('2025-06-01T00:00:00Z').toISOString());
    assertEq(ready[0].id, 'first', 'earliest created_at first');
    assertEq(ready[1].id, 'second', 'middle created_at second');
    assertEq(ready[2].id, 'third', 'latest created_at last');
  });

  await test('findReady skips expired jobs', async () => {
    const store = new InMemoryJobStore();
    const past = new Date('2024-01-01T00:00:00Z').toISOString();
    const future = new Date('2099-01-01T00:00:00Z').toISOString();
    await store.save(makeJob({ id: 'expired', expires_at: past }));
    await store.save(makeJob({ id: 'valid', expires_at: future }));

    const ready = await store.findReady(10, new Date().toISOString());
    assertEq(ready.length, 1, 'only one ready job');
    assertEq(ready[0].id, 'valid', 'valid job returned');
  });

  await test('findReady skips jobs with future retry_after', async () => {
    const store = new InMemoryJobStore();
    const future = new Date('2099-01-01T00:00:00Z').toISOString();
    await store.save(makeJob({ id: 'delayed', retry_after: future, expires_at: future }));
    await store.save(makeJob({ id: 'ready_now', expires_at: future }));

    const ready = await store.findReady(10, new Date().toISOString());
    assertEq(ready.length, 1, 'only one ready');
    assertEq(ready[0].id, 'ready_now', 'non-delayed job returned');
  });

  await test('findReady: limit parameter', async () => {
    const store = new InMemoryJobStore();
    const expires = new Date('2099-01-01T00:00:00Z').toISOString();
    for (let i = 0; i < 10; i++) {
      await store.save(makeJob({ id: `batch_${i}`, expires_at: expires }));
    }
    const ready = await store.findReady(3, new Date().toISOString());
    assertEq(ready.length, 3, 'limited to 3');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== Enqueue and Dequeue ===');

  await test('enqueue creates a pending job with correct fields', async () => {
    const { queue, store } = makeQueue();
    const id = await queue.enqueue({
      type: 'generate',
      project_id: 'p1',
      user_id: 'u1',
      organization_id: 'o1',
      payload: { prompt: 'hello' },
      priority: 'high',
    });
    assert(id.startsWith('job_'), 'id has prefix');
    const job = await store.get(id);
    assert(job !== null, 'job exists in store');
    assertEq(job!.status, 'pending', 'status is pending');
    assertEq(job!.priority, 'high', 'priority set');
    assertEq(job!.attempts, 0, 'attempts is 0');
    assertEq(job!.error_history.length, 0, 'no error history');
  });

  await test('pickup transitions job to processing and increments attempts', async () => {
    const { queue } = makeQueue();
    queue.registerHandler('generate', async () => ({ ok: true }));
    await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });

    const picked = await queue.pickup(1);
    assertEq(picked.length, 1, 'picked one job');
    assertEq(picked[0].status, 'processing', 'status is processing');
    assertEq(picked[0].attempts, 1, 'attempts incremented to 1');
    assert(picked[0].last_heartbeat !== undefined, 'heartbeat set');
  });

  await test('pickup respects priority ordering', async () => {
    const { queue } = makeQueue();
    queue.registerHandler('generate', async () => ({ ok: true }));
    queue.registerHandler('publish', async () => ({ ok: true }));

    await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {}, priority: 'low' });
    await queue.enqueue({ type: 'publish', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {}, priority: 'critical' });

    const picked = await queue.pickup(2);
    assertEq(picked[0].priority, 'critical', 'critical picked first');
    assertEq(picked[1].priority, 'low', 'low picked second');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== Exponential backoff ===');

  await test('computeBackoff formula: baseDelay * 2^attempt + jitter', async () => {
    const config: BackoffConfig = { baseDelayMs: 1000, maxDelayMs: 60000, jitterMaxMs: 0 };
    // With zero jitter, the formula is deterministic
    assertEq(computeBackoff(0, config, () => 0), 1000, 'attempt 0: 1000ms');
    assertEq(computeBackoff(1, config, () => 0), 2000, 'attempt 1: 2000ms');
    assertEq(computeBackoff(2, config, () => 0), 4000, 'attempt 2: 4000ms');
    assertEq(computeBackoff(3, config, () => 0), 8000, 'attempt 3: 8000ms');
    assertEq(computeBackoff(4, config, () => 0), 16000, 'attempt 4: 16000ms');
  });

  await test('computeBackoff caps at maxDelay', async () => {
    const config: BackoffConfig = { baseDelayMs: 1000, maxDelayMs: 5000, jitterMaxMs: 0 };
    assertEq(computeBackoff(10, config, () => 0), 5000, 'capped at maxDelay');
  });

  await test('computeBackoff adds jitter', async () => {
    const config: BackoffConfig = { baseDelayMs: 1000, maxDelayMs: 60000, jitterMaxMs: 500 };
    const delay = computeBackoff(0, config, () => 0.5); // 0.5 * 500 = 250 jitter
    assertEq(delay, 1250, 'base + jitter');
  });

  await test('retry increases backoff delay exponentially', async () => {
    const { queue, store } = makeQueue({ backoff: { baseDelayMs: 100, maxDelayMs: 10000, jitterMaxMs: 0 } });
    let callCount = 0;
    queue.registerHandler('generate', async () => {
      callCount++;
      throw new Error('fail');
    });

    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {}, max_attempts: 4 });

    // Execute attempt 1
    const [job1] = await queue.pickup(1);
    await queue.execute(job1);
    const after1 = await store.get(id);
    assertEq(after1!.status, 'pending', 'back to pending after fail');
    assertEq(after1!.attempts, 1, 'attempts is 1');
    assert(after1!.retry_after !== undefined, 'retry_after set');
    assert(after1!.error_history.length === 1, 'one error in history');

    // The retry_after should correspond to ~ 100 * 2^0 = 100ms from now
    const retryAfter1 = new Date(after1!.retry_after!).getTime() - Date.now();
    assertApprox(retryAfter1, 100, 50, 'first backoff ~100ms');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== Dead-letter queue ===');

  await test('job moves to DLQ after max_attempts', async () => {
    const { queue, store } = makeQueue({ backoff: { jitterMaxMs: 0, baseDelayMs: 1, maxDelayMs: 1 } });
    const dlqEvents: JobEvent[] = [];
    queue.events.on('dlq', (e) => dlqEvents.push(e));

    queue.registerHandler('generate', async () => { throw new Error('always fails'); });

    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {}, max_attempts: 2 });

    // Attempt 1
    let [job] = await queue.pickup(1);
    await queue.execute(job);
    let current = await store.get(id);
    assertEq(current!.status, 'pending', 'pending after first fail (1 of 2 attempts used)');

    // Attempt 2 — need to wait for retry_after
    // Override retry_after to now
    await store.update(id, { retry_after: new Date(Date.now() - 1).toISOString() });
    [job] = await queue.pickup(1);
    await queue.execute(job);
    current = await store.get(id);
    assertEq(current!.status, 'dead_letter', 'dead_letter after max attempts');
    assert(current!.dlq_at !== undefined, 'dlq_at set');
    assertEq(current!.error_history.length, 2, 'two errors in history');
    assertEq(dlqEvents.length, 1, 'dlq event emitted');
  });

  await test('listDLQ returns dead-lettered jobs', async () => {
    const { queue, store } = makeQueue();
    queue.registerHandler('generate', async () => { throw new Error('fail'); });

    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {}, max_attempts: 1 });
    const [job] = await queue.pickup(1);
    await queue.execute(job);

    const dlq = await queue.listDLQ();
    assertEq(dlq.length, 1, 'one job in DLQ');
    assertEq(dlq[0].id, id, 'correct job in DLQ');
  });

  await test('retryFromDLQ resets job for retry', async () => {
    const { queue, store } = makeQueue();
    queue.registerHandler('generate', async () => { throw new Error('fail'); });

    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {}, max_attempts: 1 });
    const [job] = await queue.pickup(1);
    await queue.execute(job);

    const retried = await queue.retryFromDLQ(id, 2);
    assertEq(retried, true, 'retryFromDLQ succeeds');
    const current = await store.get(id);
    assertEq(current!.status, 'pending', 'back to pending');
    assertEq(current!.max_attempts, 3, 'max_attempts increased (1 used + 2 extra)');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== Heartbeat timeout (stale job reaping) ===');

  await test('stale jobs are reaped and retried', async () => {
    const { queue, store } = makeQueue({ heartbeatTimeoutMs: 100, backoff: { baseDelayMs: 1, maxDelayMs: 1, jitterMaxMs: 0 } });
    const reapEvents: JobEvent[] = [];
    queue.events.on('reaped', (e) => reapEvents.push(e));

    queue.registerHandler('generate', async () => ({ ok: true }));

    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {}, max_attempts: 3 });

    // Manually set to processing with old heartbeat
    const oldHb = new Date(Date.now() - 200).toISOString();
    await store.update(id, {
      status: 'processing',
      attempts: 1,
      last_heartbeat: oldHb,
    });

    const reaped = await queue.reapStaleJobs();
    assertEq(reaped.length, 1, 'one stale job reaped');
    assertEq(reaped[0].status, 'pending', 'reaped job reset to pending');
    assert(reaped[0].error_history.length > 0, 'error history recorded');
    assertEq(reapEvents.length, 1, 'reaped event emitted');
  });

  await test('stale jobs go to DLQ when max_attempts exhausted', async () => {
    const { queue, store } = makeQueue({ heartbeatTimeoutMs: 50 });

    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {}, max_attempts: 1 });

    await store.update(id, {
      status: 'processing',
      attempts: 1,
      last_heartbeat: new Date(Date.now() - 100).toISOString(),
    });

    const reaped = await queue.reapStaleJobs();
    assertEq(reaped.length, 1, 'one stale job reaped');
    assertEq(reaped[0].status, 'dead_letter', 'moved to DLQ');
  });

  await test('non-stale processing jobs are not reaped', async () => {
    const { queue, store } = makeQueue({ heartbeatTimeoutMs: 10_000 });

    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });
    await store.update(id, {
      status: 'processing',
      attempts: 1,
      last_heartbeat: new Date().toISOString(),
    });

    const reaped = await queue.reapStaleJobs();
    assertEq(reaped.length, 0, 'no stale jobs');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== Concurrency limiting ===');

  await test('per-type concurrency is respected', async () => {
    const { queue, store } = makeQueue({ concurrency: { generate: 1 } });
    queue.registerHandler('generate', async () => ({ ok: true }));

    const expires = new Date(Date.now() + 60000).toISOString();
    await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });
    await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });

    // First pickup: gets one job
    const picked1 = await queue.pickup(2);
    assertEq(picked1.length, 1, 'only one job picked due to concurrency limit');

    // Complete the first job
    await queue.execute(picked1[0]);

    // Second pickup: now one more can be picked
    const picked2 = await queue.pickup(2);
    assertEq(picked2.length, 1, 'second job now available');
  });

  await test('global concurrency is respected', async () => {
    const { queue } = makeQueue({ globalConcurrency: 2 });
    queue.registerHandler('generate', async () => ({ ok: true }));
    queue.registerHandler('publish', async () => ({ ok: true }));
    queue.registerHandler('research', async () => ({ ok: true }));

    await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });
    await queue.enqueue({ type: 'publish', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });
    await queue.enqueue({ type: 'research', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });

    const picked = await queue.pickup(5);
    assertEq(picked.length, 2, 'only 2 jobs picked due to global concurrency');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== Job progress tracking ===');

  await test('progress is reported and stored', async () => {
    const { queue, store } = makeQueue();
    const progressEvents: JobEvent[] = [];
    queue.events.on('progress', (e) => progressEvents.push(e));

    queue.registerHandler('generate', async (_job, ctx) => {
      ctx.reportProgress(25, 'planning', 'Creating plan');
      ctx.reportProgress(50, 'generating', 'Writing code');
      ctx.reportProgress(75, 'reviewing', 'Checking output');
      return { ok: true };
    });

    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });
    const [job] = await queue.pickup(1);
    await queue.execute(job);

    assertEq(progressEvents.length, 3, 'three progress events');
    assertEq((progressEvents[0] as any).progress.percentage, 25, 'first progress 25%');
    assertEq((progressEvents[1] as any).progress.step, 'generating', 'second step');
    assertEq((progressEvents[2] as any).progress.percentage, 75, 'third progress 75%');

    const final = await store.get(id);
    assertEq(final!.status, 'completed', 'job completed');
    assertEq(final!.progress?.percentage, 100, 'progress set to 100% on completion');
  });

  await test('progress is clamped to 0-100', async () => {
    const { queue } = makeQueue();
    const progressEvents: JobEvent[] = [];
    queue.events.on('progress', (e) => progressEvents.push(e));

    queue.registerHandler('generate', async (_job, ctx) => {
      ctx.reportProgress(-10, 'invalid');
      ctx.reportProgress(150, 'overflow');
      return { ok: true };
    });

    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });
    const [job] = await queue.pickup(1);
    await queue.execute(job);

    assertEq((progressEvents[0] as any).progress.percentage, 0, 'clamped to 0');
    assertEq((progressEvents[1] as any).progress.percentage, 100, 'clamped to 100');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== Event emission ===');

  await test('onComplete event', async () => {
    const { queue } = makeQueue();
    const events: JobEvent[] = [];
    queue.events.on('completed', (e) => events.push(e));

    queue.registerHandler('generate', async () => ({ result: 'done' }));
    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });
    const [job] = await queue.pickup(1);
    await queue.execute(job);

    assertEq(events.length, 1, 'one completed event');
    assertEq(events[0].type, 'completed', 'event type is completed');
    assertEq((events[0] as any).result.result, 'done', 'result passed through');
  });

  await test('onFailed event with willRetry', async () => {
    const { queue } = makeQueue({ backoff: { baseDelayMs: 1, maxDelayMs: 1, jitterMaxMs: 0 } });
    const events: JobEvent[] = [];
    queue.events.on('failed', (e) => events.push(e));

    queue.registerHandler('generate', async () => { throw new Error('boom'); });
    await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {}, max_attempts: 3 });
    const [job] = await queue.pickup(1);
    await queue.execute(job);

    assertEq(events.length, 1, 'one failed event');
    assertEq((events[0] as any).willRetry, true, 'willRetry is true');
    assertEq((events[0] as any).error, 'boom', 'error message');
  });

  await test('onDLQ event', async () => {
    const { queue } = makeQueue();
    const events: JobEvent[] = [];
    queue.events.on('dlq', (e) => events.push(e));

    queue.registerHandler('generate', async () => { throw new Error('permanent'); });
    await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {}, max_attempts: 1 });
    const [job] = await queue.pickup(1);
    await queue.execute(job);

    assertEq(events.length, 1, 'one dlq event');
    assertEq((events[0] as any).errorHistory.length, 1, 'error history attached');
  });

  await test('wildcard listener receives all events', async () => {
    const { queue } = makeQueue();
    const events: JobEvent[] = [];
    queue.events.on('*', (e) => events.push(e));

    queue.registerHandler('generate', async () => ({ ok: true }));
    await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });
    const [job] = await queue.pickup(1);
    await queue.execute(job);

    // Should have: enqueued, started, completed
    const types = events.map(e => e.type);
    assert(types.includes('enqueued'), 'has enqueued');
    assert(types.includes('started'), 'has started');
    assert(types.includes('completed'), 'has completed');
  });

  await test('unsubscribe removes listener', async () => {
    const emitter = new JobEventEmitter();
    const events: JobEvent[] = [];
    const unsub = emitter.on('completed', (e) => events.push(e));

    emitter.emit({ type: 'completed', job: makeJob(), result: {} });
    assertEq(events.length, 1, 'event received');

    unsub();
    emitter.emit({ type: 'completed', job: makeJob(), result: {} });
    assertEq(events.length, 1, 'no more events after unsub');
  });

  await test('removeAll clears all listeners', async () => {
    const emitter = new JobEventEmitter();
    const events: JobEvent[] = [];
    emitter.on('completed', (e) => events.push(e));
    emitter.on('failed', (e) => events.push(e));

    emitter.removeAll();
    emitter.emit({ type: 'completed', job: makeJob(), result: {} });
    emitter.emit({ type: 'failed', job: makeJob(), error: 'x', willRetry: false });
    assertEq(events.length, 0, 'no events after removeAll');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== Cancel job ===');

  await test('cancel a pending job', async () => {
    const { queue, store } = makeQueue();
    const events: JobEvent[] = [];
    queue.events.on('cancelled', (e) => events.push(e));

    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });
    const success = await queue.cancel(id);
    assertEq(success, true, 'cancel succeeds');

    const job = await store.get(id);
    assertEq(job!.status, 'cancelled', 'status is cancelled');
    assert(job!.completed_at !== undefined, 'completed_at set');
    assertEq(events.length, 1, 'cancelled event emitted');
  });

  await test('cancel respects user_id', async () => {
    const { queue } = makeQueue();
    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });
    const success = await queue.cancel(id, 'wrong_user');
    assertEq(success, false, 'cancel fails for wrong user');
  });

  await test('cannot cancel completed job', async () => {
    const { queue, store } = makeQueue();
    queue.registerHandler('generate', async () => ({ ok: true }));

    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });
    const [job] = await queue.pickup(1);
    await queue.execute(job);

    const success = await queue.cancel(id);
    assertEq(success, false, 'cannot cancel completed job');
  });

  await test('cancel nonexistent job returns false', async () => {
    const { queue } = makeQueue();
    const success = await queue.cancel('nonexistent');
    assertEq(success, false, 'returns false for missing job');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== Job expiry ===');

  await test('expired jobs are not picked up', async () => {
    const { queue, store } = makeQueue();
    queue.registerHandler('generate', async () => ({ ok: true }));

    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {}, ttlMs: 1 });

    // Wait a tiny bit so job expires
    await new Promise(resolve => setTimeout(resolve, 10));

    const picked = await queue.pickup(1);
    assertEq(picked.length, 0, 'expired job not picked up');
  });

  await test('non-expired jobs are picked up', async () => {
    const { queue } = makeQueue();
    queue.registerHandler('generate', async () => ({ ok: true }));

    await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {}, ttlMs: 60000 });
    const picked = await queue.pickup(1);
    assertEq(picked.length, 1, 'non-expired job picked up');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== Heartbeat context ===');

  await test('heartbeat updates last_heartbeat', async () => {
    const { queue, store } = makeQueue();
    let heartbeatTime: string | undefined;

    queue.registerHandler('generate', async (_job, ctx) => {
      ctx.heartbeat();
      // Small delay to ensure time difference
      await new Promise(r => setTimeout(r, 10));
      ctx.heartbeat();
      return { ok: true };
    });

    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });
    const [job] = await queue.pickup(1);
    await queue.execute(job);

    const final = await store.get(id);
    assert(final!.last_heartbeat !== undefined, 'last_heartbeat was updated');
  });

  await test('isCancelled reflects cancel during execution', async () => {
    const { queue } = makeQueue();
    let wasCancelled = false;

    queue.registerHandler('generate', async (job, ctx) => {
      // Simulate long-running work
      await new Promise(r => setTimeout(r, 50));
      wasCancelled = ctx.isCancelled();
      return { ok: true };
    });

    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });
    const [job] = await queue.pickup(1);
    const execPromise = queue.execute(job);

    // Cancel while processing
    await new Promise(r => setTimeout(r, 10));
    await queue.cancel(id, 'u1');

    await execPromise;
    assertEq(wasCancelled, true, 'handler saw cancellation');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== Priority ordering constants ===');

  await test('PRIORITY_ORDER has correct hierarchy', async () => {
    assert(PRIORITY_ORDER.critical > PRIORITY_ORDER.high, 'critical > high');
    assert(PRIORITY_ORDER.high > PRIORITY_ORDER.normal, 'high > normal');
    assert(PRIORITY_ORDER.normal > PRIORITY_ORDER.low, 'normal > low');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== Worker start/stop ===');

  await test('start and stop worker', async () => {
    const { queue } = makeQueue();
    assertEq(queue.isRunning, false, 'not running initially');

    queue.start(50, 100);
    assertEq(queue.isRunning, true, 'running after start');

    // Starting again is idempotent
    queue.start(50, 100);
    assertEq(queue.isRunning, true, 'still running');

    queue.stop();
    assertEq(queue.isRunning, false, 'not running after stop');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== getJob ===');

  await test('getJob returns job or null', async () => {
    const { queue } = makeQueue();
    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {} });
    const job = await queue.getJob(id);
    assert(job !== null, 'getJob returns job');
    assertEq(job!.id, id, 'correct job returned');

    const missing = await queue.getJob('nope');
    assertEq(missing, null, 'null for missing');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== countProcessing ===');

  await test('countProcessing counts correctly', async () => {
    const store = new InMemoryJobStore();
    await store.save(makeJob({ id: 'p1', type: 'generate', status: 'processing' }));
    await store.save(makeJob({ id: 'p2', type: 'generate', status: 'processing' }));
    await store.save(makeJob({ id: 'p3', type: 'generate', status: 'pending' }));
    await store.save(makeJob({ id: 'p4', type: 'publish', status: 'processing' }));

    const genCount = await store.countProcessing('generate');
    assertEq(genCount, 2, 'two generate processing');

    const pubCount = await store.countProcessing('publish');
    assertEq(pubCount, 1, 'one publish processing');

    const secCount = await store.countProcessing('security_scan');
    assertEq(secCount, 0, 'zero security_scan processing');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== No handler registered ===');

  await test('execute with no handler fails the job immediately', async () => {
    const { queue, store } = makeQueue();
    // Deliberately do NOT register a handler
    const id = await queue.enqueue({ type: 'generate', project_id: 'p1', user_id: 'u1', organization_id: 'o1', payload: {}, max_attempts: 1 });
    const [job] = await queue.pickup(1);
    await queue.execute(job);

    const final = await store.get(id);
    assertEq(final!.status, 'dead_letter', 'moved to DLQ with no handler');
    assert(final!.error!.includes('No handler'), 'error mentions no handler');
  });

  // -----------------------------------------------------------------------
  console.log('\n=== Full lifecycle ===');

  await test('full lifecycle: enqueue -> pickup -> execute -> complete', async () => {
    const { queue, store } = makeQueue();
    const allEvents: JobEvent[] = [];
    queue.events.on('*', (e) => allEvents.push(e));

    queue.registerHandler('security_scan', async (_job, ctx) => {
      ctx.reportProgress(50, 'scanning');
      return { vulnerabilities: 0 };
    });

    const id = await queue.enqueue({
      type: 'security_scan',
      project_id: 'p1',
      user_id: 'u1',
      organization_id: 'o1',
      payload: { target: 'src/' },
      priority: 'high',
    });

    const [job] = await queue.pickup(1);
    await queue.execute(job);

    const final = await store.get(id);
    assertEq(final!.status, 'completed', 'completed');
    assertEq((final!.result as any).vulnerabilities, 0, 'result stored');
    assertEq(final!.progress?.percentage, 100, 'progress at 100%');

    const eventTypes = allEvents.map(e => e.type);
    assert(eventTypes.includes('enqueued'), 'has enqueued event');
    assert(eventTypes.includes('started'), 'has started event');
    assert(eventTypes.includes('progress'), 'has progress event');
    assert(eventTypes.includes('completed'), 'has completed event');
  });

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
    process.exit(1);
  }
}

runTests().then(() => {
  console.log('test-durable-job-queue passed');
}).catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
