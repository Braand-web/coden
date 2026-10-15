/**
 * Async Job Queue — persistent task queue backed by Supabase.
 *
 * Solves: "Timeout Railway sur générations >30s — pas de job queue"
 *
 * Architecture:
 * - Jobs are persisted to the `agent_jobs` Supabase table
 * - A lightweight in-process worker picks them up (no Redis, no BullMQ)
 * - SSE heartbeat keeps the client connection alive during long jobs
 * - On reconnection, clients can poll job status via /api/jobs/:id
 *
 * This gives us durable job execution without external infrastructure.
 * For Railway: the same Node.js process handles both HTTP and background jobs.
 *
 * Job lifecycle: pending → processing → completed | failed | cancelled
 */

import { requireDatabaseResult } from './database-result.ts';
import { randomUUID } from 'node:crypto';
import { redactSecrets } from './secret-redaction.ts';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type JobPriority = 'critical' | 'high' | 'normal' | 'low';

export type CodenJob = {
  id: string;
  type: 'generate' | 'auto_fix' | 'security_scan' | 'publish' | 'media_gen' | 'research' | 'workflow_run';
  status: JobStatus;
  priority: JobPriority;
  project_id: string;
  user_id: string;
  organization_id: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  attempts: number;
  max_attempts: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  expires_at: string;     // jobs expire after this — prevents stuck queues
  queue_version?: number;
  idempotency_key?: string | null;
  lease_token?: string | null;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  reconciliation_required?: boolean;
  resume_count?: number;
  last_resumed_at?: string | null;
  event_sequence?: number;
};

export type JobProgress = (step: string, message: string) => Promise<void>;
export type JobExecutionContext = {
  /** Handlers must honor this signal before starting further provider calls. */
  signal: AbortSignal;
  renewLease: () => Promise<void>;
  /** Await immediately before each provider mutation; fails closed on lease loss. */
  assertLease: () => Promise<void>;
};
export type JobHandler<TPayload = Record<string, unknown>, TResult = Record<string, unknown>> = (
  job: CodenJob & { payload: TPayload },
  onProgress?: JobProgress,
  context?: JobExecutionContext,
) => Promise<TResult>;

export type JobQueueOptions = {
  /** Defaults to CODEN_PUBLICATION_V2=1. */
  durable?: boolean;
  leaseDurationMs?: number;
  onError?: (error: unknown) => void;
};
export type JobScope = { user_id: string; organization_id?: string; project_id?: string };
export type JobEvent = { id: string; job_id: string; sequence: number; step: string; message: string; created_at: string; metadata?: Record<string, unknown> };
export type EnqueueJobInput = {
  type: CodenJob['type'];
  project_id: string;
  user_id: string;
  organization_id: string;
  payload: Record<string, unknown>;
  priority?: JobPriority;
  max_attempts?: number;
  idempotency_key?: string;
};

// ─── In-memory queue with Supabase persistence ────────────────────────────────

const POLLING_INTERVAL_MS = 2_000;   // check for new jobs every 2s
const MAX_CONCURRENT_JOBS = 3;        // Railway free tier friendly
const JOB_TTL_MS = 30 * 60 * 1000;  // jobs expire after 30 minutes

type QueueState = {
  handlers: Map<CodenJob['type'], JobHandler>;
  activeJobs: Map<string, Promise<void>>;
  isRunning: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
  supabase: any; // lazy injected to avoid circular imports
  durable: boolean;
  leaseDurationMs: number;
  workerId: string;
  pickingUp: boolean;
  onError?: (error: unknown) => void;
};

const queue: QueueState = {
  handlers: new Map(),
  activeJobs: new Map(),
  isRunning: false,
  pollTimer: null,
  supabase: null,
  durable: false,
  leaseDurationMs: 60_000,
  workerId: randomUUID(),
  pickingUp: false,
};

/**
 * Initialize the job queue with a Supabase client.
 * Call this once at server startup.
 */
export function initJobQueue(supabaseClient: any, options: JobQueueOptions = {}): void {
  if (queue.activeJobs.size || queue.pickingUp) throw new Error('Cannot reinitialize an active job queue.');
  queue.supabase = supabaseClient;
  queue.durable = options.durable ?? process.env.CODEN_PUBLICATION_V2 === '1';
  queue.leaseDurationMs = Math.max(10_000, Math.min(300_000, options.leaseDurationMs ?? 60_000));
  queue.onError = options.onError;
}

export function isDurableJobQueueEnabled(): boolean { return queue.durable; }

function requireDurableClient(): any {
  if (!queue.supabase) throw new Error('Durable job queue requires database persistence.');
  return queue.supabase;
}

function reportQueueError(error: unknown): void {
  // Do not log provider messages, payloads, SQL details, or lease tokens.
  console.error('[coden:job_queue] Durable queue operation failed.');
  try { queue.onError?.(error); } catch { console.error('[coden:job_queue] Error observer failed.'); }
}

function publicJob(job: CodenJob): CodenJob {
  const { lease_token: _token, lease_owner: _owner, idempotency_key: _key, ...safe } = job;
  return safe;
}

function scopedQuery(query: any, scope: JobScope): any {
  if (!scope.user_id?.trim()) throw new Error('Job owner is required.');
  query = query.eq('user_id', scope.user_id);
  if (scope.organization_id) query = query.eq('organization_id', scope.organization_id);
  if (scope.project_id) query = query.eq('project_id', scope.project_id);
  return query;
}

/**
 * Register a handler for a job type.
 */
export function registerJobHandler(type: CodenJob['type'], handler: JobHandler): void {
  queue.handlers.set(type, handler);
}

/**
 * Enqueue a new job. Returns the job ID immediately.
 * The actual execution happens asynchronously in the background.
 */
export async function enqueueJob(input: EnqueueJobInput): Promise<string> {
  if (queue.durable) {
    const client = requireDurableClient();
    const key = input.idempotency_key;
    if (key !== undefined && (!key.trim() || key.length > 200)) throw new Error('Invalid job idempotency key.');
    const maxAttempts = input.type === 'publish' ? 1 : (input.max_attempts ?? 3);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) throw new Error('Invalid job max_attempts.');
    const rows = await requireDatabaseResult<CodenJob[]>(client.rpc('enqueue_agent_job', {
      p_id: `durable-job-${randomUUID()}`,
      p_type: input.type,
      p_project_id: input.project_id,
      p_user_id: input.user_id,
      p_organization_id: input.organization_id,
      p_payload: input.payload,
      p_priority: input.priority ?? 'normal',
      p_max_attempts: maxAttempts,
      p_idempotency_key: key ?? null,
    }), 'enqueue durable job');
    if (!rows?.[0]?.id) throw new Error('Durable job was not acknowledged by the database.');
    return rows[0].id;
  }
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + JOB_TTL_MS);

  const job: CodenJob = {
    id: jobId,
    type: input.type,
    status: 'pending',
    priority: input.priority ?? 'normal',
    project_id: input.project_id,
    user_id: input.user_id,
    organization_id: input.organization_id,
    payload: input.payload,
    attempts: 0,
    max_attempts: input.max_attempts ?? 3,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  // Persist to Supabase
  if (queue.supabase) {
    // Never acknowledge a durable job that the worker cannot retrieve.
    await requireDatabaseResult(queue.supabase.from('agent_jobs').insert(job), 'enqueue job');
  } else {
    // Fallback: in-memory execution (no persistence, but still async)
    queueMicrotask(() => { void executeJobInProcess(job).catch(reportQueueError); });
  }

  return jobId;
}

/**
 * Get the current status of a job.
 */
export async function getJobStatus(jobId: string, scope?: JobScope): Promise<CodenJob | null> {
  if (!queue.supabase) return null;
  let query = queue.supabase
    .from('agent_jobs')
    .select('*')
    .eq('id', jobId);
  if (scope) query = scopedQuery(query, scope);
  const data = await requireDatabaseResult<CodenJob | null>(query.maybeSingle(), 'retrieve job');
  return data ? publicJob(data) : null;
}

/** Owner-scoped API for HTTP callers using a service-role database client. */
export async function getJobForUser(jobId: string, scope: JobScope): Promise<CodenJob | null> {
  if (!scope?.user_id?.trim()) throw new Error('Job owner is required.');
  return getJobStatus(jobId, scope);
}

/** Stable sequence cursor (exclusive); authorization is checked before reading events. */
export async function listJobEvents(jobId: string, scope: JobScope, options: { afterSequence?: number; limit?: number } = {}): Promise<JobEvent[]> {
  const after = options.afterSequence ?? 0;
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid job event pagination.');
  if (!await getJobForUser(jobId, scope)) return [];
  return await requireDatabaseResult<JobEvent[]>(queue.supabase.from('agent_job_events')
    .select('id,job_id,sequence,step,message,created_at,metadata').eq('job_id', jobId)
    .gt('sequence', after).order('sequence', { ascending: true }).limit(limit), 'list job events') ?? [];
}

/**
 * Cancel a pending or processing job.
 */
export async function cancelJob(jobId: string, userId: string): Promise<boolean> {
  if (!queue.supabase) return false;
  if (queue.durable || jobId.startsWith('durable-job-')) {
    return await requireDatabaseResult<boolean>(queue.supabase.rpc('cancel_agent_job', { p_job_id: jobId, p_user_id: userId }), 'cancel durable job') === true;
  }
  const { error } = await queue.supabase
    .from('agent_jobs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('user_id', userId)
    .in('status', ['pending', 'processing']);
  return !error;
}

/**
 * Explicit user-authorized recovery only, never called by polling/reconciliation.
 * The caller must validate project access and the current immutable candidate.
 * The resumed handler must reconcile saved provider state before creating any
 * deployment: an old provider request may have succeeded before its lease died.
 * null deliberately conflates missing, wrong owner, ineligible and exhausted jobs.
 */
export async function resumePublishJob(jobId: string, userId: string): Promise<CodenJob | null> {
  if (!queue.durable) throw new Error('Durable job queue is not enabled.');
  if (!jobId?.trim() || !userId?.trim()) throw new Error('Job and owner are required.');
  // Do not requeue underneath an old local handler that has not yet settled.
  if (queue.activeJobs.has(jobId)) return null;
  const rows = await requireDatabaseResult<CodenJob[]>(requireDurableClient().rpc('resume_publish_job', {
    p_job_id: jobId, p_user_id: userId,
  }), 'resume publication job');
  return rows?.[0] ? publicJob(rows[0]) : null;
}

/**
 * Server-only fence for a current durable lease; does not extend or mint a lease.
 * false is an invalid/stale/expired lease; database errors reject (not false).
 * This check cannot revoke a provider request that was already sent.
 */
export async function authorizeJobLease(jobId: string, leaseToken: string): Promise<boolean> {
  if (!jobId?.trim() || !leaseToken?.trim()) return false;
  return await requireDatabaseResult<boolean>(requireDurableClient().rpc('authorize_agent_job_lease', {
    p_job_id: jobId, p_lease_token: leaseToken,
  }), 'authorize job lease') === true;
}

// ─── Worker process ───────────────────────────────────────────────────────────

/**
 * Starts the background worker that polls for pending jobs.
 * Safe to call multiple times — only starts one worker instance.
 */
export function startJobWorker(): void {
  if (queue.isRunning) return;
  queue.isRunning = true;

  console.log('[coden:job_queue] Worker started');

  queue.pollTimer = setInterval(async () => {
    try { await runJobWorkerOnce(); } catch (error) { reportQueueError(error); }
  }, POLLING_INTERVAL_MS);

  // Graceful shutdown
  process.once('SIGTERM', stopJobWorker);
  process.once('SIGINT', stopJobWorker);
}

export function stopJobWorker(): void {
  if (queue.pollTimer) {
    clearInterval(queue.pollTimer);
    queue.pollTimer = null;
  }
  queue.isRunning = false;
  process.removeListener('SIGTERM', stopJobWorker);
  process.removeListener('SIGINT', stopJobWorker);
  console.log('[coden:job_queue] Worker stopped');
}

/** One bounded worker pass. Useful for schedulers/tests; persistence failures reject. */
export async function runJobWorkerOnce(): Promise<void> {
  if (!queue.supabase || queue.pickingUp) return;

  queue.pickingUp = true;
  const executions: Promise<void>[] = [];
  let pickupError: unknown;
  try {
    if (queue.durable) {
      // Recovery must run even when all local slots are occupied by handlers
      // whose leases were lost and whose provider requests have not settled.
      await requireDatabaseResult(queue.supabase.rpc('reconcile_expired_agent_jobs', {}), 'reconcile expired job leases');
      const available = MAX_CONCURRENT_JOBS - queue.activeJobs.size;
      if (available > 0) {
        const jobs = await requireDatabaseResult<CodenJob[]>(queue.supabase.rpc('claim_agent_jobs', {
          p_worker_id: queue.workerId,
          p_limit: available,
          p_lease_seconds: Math.ceil(queue.leaseDurationMs / 1000),
          p_types: [...queue.handlers.keys()],
        }), 'claim durable jobs') ?? [];
        for (const job of jobs) executions.push(trackExecution(job, () => executeDurableJob(job)));
      }
    }
    // Continue draining legacy jobs when durable mode is enabled. This filter uses
    // an old-schema column so flag-off installations need not have the migration.
    const remaining = MAX_CONCURRENT_JOBS - queue.activeJobs.size;
    if (remaining > 0) {
      const jobs = await requireDatabaseResult<CodenJob[]>(queue.supabase
        .from('agent_jobs')
        .select('*')
        .eq('status', 'pending')
        .not('id', 'like', 'durable-job-%')
        .or('type.neq.publish,payload->>publication_snapshot_id.is.null')
        .lt('expires_at', new Date(Date.now() + JOB_TTL_MS).toISOString())
        .gt('expires_at', new Date().toISOString())
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(remaining), 'poll legacy jobs') ?? [];
      for (const job of jobs) {
        if (!queue.activeJobs.has(job.id)) executions.push(trackExecution(job, () => executeJobInProcess(job)));
      }
    }
  } catch (error) {
    pickupError = error;
  } finally {
    queue.pickingUp = false;
  }
  const results = await Promise.allSettled(executions);
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason);
  if (pickupError) failures.unshift(pickupError);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Multiple job queue operations failed.');
}

function trackExecution(job: CodenJob, run: () => Promise<void>): Promise<void> {
  if (queue.activeJobs.has(job.id)) throw new Error('Database returned an already active job claim.');
  const execution = Promise.resolve().then(run);
  queue.activeJobs.set(job.id, execution);
  // Unlike finally(), these observers do not create an unhandled rejected promise.
  void execution.then(() => queue.activeJobs.delete(job.id), () => queue.activeJobs.delete(job.id));
  return execution;
}

async function executeDurableJob(job: CodenJob): Promise<void> {
  const client = requireDurableClient();
  if (!job.lease_token || job.status !== 'processing' || job.queue_version !== 2) throw new Error('Invalid durable job claim.');
  const controller = new AbortController();
  let leaseError: unknown;
  let renewal: Promise<void> | undefined;
  let closing = false;
  const renewLease = (): Promise<void> => {
    if (closing || leaseError || controller.signal.aborted) return Promise.reject(leaseError ?? new Error('Job lease is no longer active.'));
    if (renewal) return renewal;
    renewal = (async () => {
      const renewed = await requireDatabaseResult<boolean>(client.rpc('renew_agent_job_lease', {
        p_job_id: job.id, p_lease_token: job.lease_token, p_lease_seconds: Math.ceil(queue.leaseDurationMs / 1000),
      }), 'renew job lease');
      if (renewed !== true) throw new Error('Job lease lost; reconciliation required.');
    })().catch(error => { leaseError = error; controller.abort(); throw error; }).finally(() => { renewal = undefined; });
    return renewal;
  };
  // Confirm ownership immediately before invoking a potentially irreversible handler.
  await renewLease();
  const timer = setInterval(() => {
    if (!closing && !leaseError) void renewLease().catch(reportQueueError);
  }, Math.floor(queue.leaseDurationMs / 3));
  timer.unref?.();
  let progressTail = Promise.resolve();
  let progressError: unknown;
  let acceptingProgress = true;
  const onProgress: JobProgress = (step, message) => {
    if (!acceptingProgress) {
      const rejected = Promise.reject(new Error('Progress emitted after the job handler returned.'));
      void rejected.catch(reportQueueError);
      return rejected;
    }
    const write = progressTail.then(async () => {
      if (progressError) throw progressError;
      if (closing || leaseError) throw leaseError ?? new Error('Job handler has finished.');
      const events = await requireDatabaseResult<JobEvent[]>(client.rpc('append_agent_job_event', {
        p_job_id: job.id, p_lease_token: job.lease_token,
        p_step: step, p_message: redactSecrets(message).slice(0, 4000),
      }), 'append job progress');
      if (!events?.[0]) throw new Error('Job event was not persisted.');
    });
    // Register a rejection observer even for old handlers that do not await progress.
    progressTail = write.then(() => undefined, error => { progressError ??= error; });
    return write;
  };
  let result: Record<string, unknown> | undefined;
  let handlerError: unknown;
  try {
    try {
      const handler = queue.handlers.get(job.type);
      if (!handler) throw new Error('No handler registered for job type.');
      result = await handler(job, onProgress, { signal: controller.signal, renewLease, assertLease: renewLease });
    } catch (error) { handlerError = error ?? new Error('Job handler failed.'); }
    acceptingProgress = false;
    // Also flush progress emitted by a handler that used the legacy void callback.
    await progressTail;
    closing = true;
    clearInterval(timer);
    if (renewal) await renewal;
    if (leaseError) throw leaseError;
    const failure = progressError ?? handlerError;
    const rows = await requireDatabaseResult<CodenJob[]>(client.rpc('finish_agent_job', {
      p_job_id: job.id, p_lease_token: job.lease_token,
      p_outcome: failure ? 'failed' : 'completed',
      p_result: failure ? null : (result ?? {}),
      p_error: failure ? redactSecrets(failure instanceof Error ? failure.message : String(failure)).slice(0, 500) : null,
      p_retry: Boolean(handlerError && !progressError && job.type !== 'publish'),
      p_reconciliation_required: Boolean(failure && job.type === 'publish'),
    }), 'finish durable job');
    if (!rows?.[0]) throw new Error('Job lease lost before completion; reconciliation required.');
    if (progressError) throw progressError;
  } finally {
    acceptingProgress = false;
    closing = true;
    clearInterval(timer);
    controller.abort();
  }
}

async function executeJobInProcess(job: CodenJob): Promise<void> {
  // This compatibility path intentionally retains legacy behavior. Never route a
  // durable job through its unfenced status updates or in-memory fallback.
  if (job.queue_version === 2 || job.id.startsWith('durable-job-') ||
    (job.type === 'publish' && job.payload.publication_snapshot_id != null)) throw new Error('Durable job requires a lease claim.');
  const handler = queue.handlers.get(job.type);
  if (!handler) {
    console.warn('[coden:job_queue] No handler for job type:', job.type);
    await updateJobStatus(job.id, 'failed', undefined, `No handler registered for type: ${job.type}`);
    return;
  }

  // Mark as processing
  await updateJobStatus(job.id, 'processing');

  const onProgress: JobProgress = async (step, message) => {
    // Progress events are written to agent_job_events table for SSE polling
    if (queue.supabase) {
      void Promise.resolve(queue.supabase.from('agent_job_events').insert({
        job_id: job.id,
        step,
        message,
        created_at: new Date().toISOString(),
      })).catch(() => null);
    }
  };

  try {
    const result = await handler(job as any, onProgress);
    await updateJobStatus(job.id, 'completed', result as Record<string, unknown>);
  } catch (err: any) {
    const attempts = job.attempts + 1;
    if (attempts < job.max_attempts) {
      // Retry: back to pending with incremented attempts
      await Promise.resolve(queue.supabase?.from('agent_jobs')
        .update({ status: 'pending', attempts, error: err?.message })
        .eq('id', job.id))
        .catch(() => null);
    } else {
      await updateJobStatus(job.id, 'failed', undefined, err?.message);
    }
    console.warn(`[coden:job_queue] Job ${job.id} (${job.type}) failed:`, err?.message);
  }
}

async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  result?: Record<string, unknown>,
  error?: string,
): Promise<void> {
  if (!queue.supabase) return;
  const now = new Date().toISOString();
  const update: Partial<CodenJob> = {
    status,
    ...(status === 'processing' ? { started_at: now, attempts: 1 } : {}),
    ...(status === 'completed' || status === 'failed' || status === 'cancelled' ? { completed_at: now } : {}),
    ...(result ? { result } : {}),
    ...(error ? { error: error.slice(0, 500) } : {}),
  };
  await Promise.resolve(queue.supabase.from('agent_jobs').update(update).eq('id', jobId)).catch(() => null);
}

// ─── Generate job handler (wraps the main generation pipeline) ────────────────

/**
 * Creates a job-queue-aware wrapper around generateFilesWithAi.
 * Use this when the generation might exceed 25s (complex apps, large projects).
 *
 * The client subscribes to SSE on /api/jobs/:jobId/events to get live progress.
 */
export function createGenerationJobPayload(input: {
  projectId: string;
  prompt: string;
  modelId?: string;
  useLastPlan?: boolean;
}): Record<string, unknown> {
  return {
    project_id: input.projectId,
    prompt: input.prompt,
    model_id: input.modelId ?? 'auto',
    use_last_plan: input.useLastPlan ?? false,
    initiated_at: new Date().toISOString(),
  };
}

/**
 * Determines if a request should use the async job queue vs inline execution.
 * Inline is faster for simple requests; queue is safer for complex ones.
 */
export function shouldUseJobQueue(input: {
  estimatedTokens: number;
  isComplexTask: boolean;
  fileCount: number;
  hasRunnerEnabled: boolean;
}): boolean {
  // Use queue for requests likely to exceed 25s
  if (input.estimatedTokens > 60_000) return true;
  if (input.isComplexTask && input.fileCount > 20) return true;
  if (input.hasRunnerEnabled && input.isComplexTask) return true;
  return false;
}
