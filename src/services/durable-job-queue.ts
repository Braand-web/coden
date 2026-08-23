/**
 * Durable Job Queue — hardened, persistent task queue with retry, DLQ, and
 * concurrency control.
 *
 * Upgrades the simple `async-job-queue.ts` with:
 * - Pluggable `JobStore` interface (in-memory for dev, Supabase/Postgres for prod)
 * - Exponential backoff retries with jitter
 * - Dead-letter queue with full error history
 * - Job progress tracking (percentage + step info)
 * - Stale job reaping via heartbeat timeout
 * - Per-type concurrency semaphore
 * - Typed event emitter for lifecycle events
 *
 * Pure TypeScript, zero external dependencies.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'dead_letter';
export type JobPriority = 'critical' | 'high' | 'normal' | 'low';
export type JobType = 'generate' | 'auto_fix' | 'security_scan' | 'publish' | 'media_gen' | 'research';

export const PRIORITY_ORDER: Record<JobPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

export type ErrorEntry = {
  attempt: number;
  message: string;
  timestamp: string;
};

export type JobProgress = {
  /** 0-100 */
  percentage: number;
  step?: string;
  message?: string;
  updated_at: string;
};

export type CodenJob = {
  id: string;
  type: JobType;
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
  expires_at: string;

  // Durable extensions
  retry_after?: string;
  dlq_at?: string;
  error_history: ErrorEntry[];
  progress?: JobProgress;
  last_heartbeat?: string;
};

// ---------------------------------------------------------------------------
// Job events
// ---------------------------------------------------------------------------

export type JobEvent =
  | { type: 'enqueued'; job: CodenJob }
  | { type: 'started'; job: CodenJob }
  | { type: 'progress'; job: CodenJob; progress: JobProgress }
  | { type: 'completed'; job: CodenJob; result: Record<string, unknown> }
  | { type: 'failed'; job: CodenJob; error: string; willRetry: boolean }
  | { type: 'dlq'; job: CodenJob; errorHistory: ErrorEntry[] }
  | { type: 'cancelled'; job: CodenJob }
  | { type: 'reaped'; job: CodenJob };

export type JobEventType = JobEvent['type'];

type EventCallback = (event: JobEvent) => void;

export class JobEventEmitter {
  private listeners = new Map<JobEventType | '*', EventCallback[]>();

  on(eventType: JobEventType | '*', cb: EventCallback): () => void {
    const list = this.listeners.get(eventType) ?? [];
    list.push(cb);
    this.listeners.set(eventType, list);
    return () => {
      const arr = this.listeners.get(eventType);
      if (arr) {
        const idx = arr.indexOf(cb);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  emit(event: JobEvent): void {
    const specific = this.listeners.get(event.type);
    if (specific) for (const cb of specific) cb(event);
    const wildcards = this.listeners.get('*');
    if (wildcards) for (const cb of wildcards) cb(event);
  }

  removeAll(): void {
    this.listeners.clear();
  }
}

// ---------------------------------------------------------------------------
// Job handler type
// ---------------------------------------------------------------------------

export type JobHandler<TPayload = Record<string, unknown>, TResult = Record<string, unknown>> = (
  job: CodenJob & { payload: TPayload },
  ctx: JobContext,
) => Promise<TResult>;

export type JobContext = {
  /** Report progress (0-100 percentage, optional step/message). */
  reportProgress: (percentage: number, step?: string, message?: string) => void;
  /** Send a heartbeat to prevent stale-reaping. Called automatically but can also be manual. */
  heartbeat: () => void;
  /** Check if the job has been cancelled. */
  isCancelled: () => boolean;
};

// ---------------------------------------------------------------------------
// JobStore interface
// ---------------------------------------------------------------------------

export interface JobStore {
  /** Persist a new job. */
  save(job: CodenJob): Promise<void>;

  /** Get a job by ID. Returns null if not found. */
  get(id: string): Promise<CodenJob | null>;

  /** Update a job (partial update, merges into existing). */
  update(id: string, changes: Partial<CodenJob>): Promise<void>;

  /** Delete a job. */
  delete(id: string): Promise<boolean>;

  /**
   * Find the next N jobs eligible for pickup:
   * - status === 'pending'
   * - retry_after is null or in the past
   * - expires_at is in the future
   * Ordered by priority (desc) then created_at (asc).
   */
  findReady(limit: number, now: string): Promise<CodenJob[]>;

  /**
   * Find processing jobs whose last_heartbeat is older than `cutoff`.
   */
  findStale(cutoffMs: number, now: string): Promise<CodenJob[]>;

  /**
   * List jobs in the dead-letter queue.
   */
  listDLQ(limit?: number): Promise<CodenJob[]>;

  /**
   * Count currently processing jobs for a given job type.
   */
  countProcessing(type: JobType): Promise<number>;
}

// ---------------------------------------------------------------------------
// InMemoryJobStore
// ---------------------------------------------------------------------------

export class InMemoryJobStore implements JobStore {
  readonly jobs = new Map<string, CodenJob>();

  async save(job: CodenJob): Promise<void> {
    this.jobs.set(job.id, structuredClone(job));
  }

  async get(id: string): Promise<CodenJob | null> {
    const j = this.jobs.get(id);
    return j ? structuredClone(j) : null;
  }

  async update(id: string, changes: Partial<CodenJob>): Promise<void> {
    const existing = this.jobs.get(id);
    if (!existing) return;
    Object.assign(existing, changes);
  }

  async delete(id: string): Promise<boolean> {
    return this.jobs.delete(id);
  }

  async findReady(limit: number, now: string): Promise<CodenJob[]> {
    const nowMs = new Date(now).getTime();
    const ready: CodenJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.status !== 'pending') continue;
      if (job.retry_after && new Date(job.retry_after).getTime() > nowMs) continue;
      if (new Date(job.expires_at).getTime() <= nowMs) continue;
      ready.push(structuredClone(job));
    }
    ready.sort((a, b) => {
      const pd = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      if (pd !== 0) return pd;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    return ready.slice(0, limit);
  }

  async findStale(cutoffMs: number, now: string): Promise<CodenJob[]> {
    const nowMs = new Date(now).getTime();
    const stale: CodenJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.status !== 'processing') continue;
      const hb = job.last_heartbeat ? new Date(job.last_heartbeat).getTime() : 0;
      if (nowMs - hb >= cutoffMs) {
        stale.push(structuredClone(job));
      }
    }
    return stale;
  }

  async listDLQ(limit = 100): Promise<CodenJob[]> {
    const dlq: CodenJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.status === 'dead_letter') dlq.push(structuredClone(job));
    }
    dlq.sort((a, b) => new Date(b.dlq_at ?? b.created_at).getTime() - new Date(a.dlq_at ?? a.created_at).getTime());
    return dlq.slice(0, limit);
  }

  async countProcessing(type: JobType): Promise<number> {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'processing' && job.type === type) count++;
    }
    return count;
  }

  /** Expose size for testing. */
  get size(): number {
    return this.jobs.size;
  }

  clear(): void {
    this.jobs.clear();
  }
}

// ---------------------------------------------------------------------------
// Backoff helper
// ---------------------------------------------------------------------------

export type BackoffConfig = {
  baseDelayMs: number;
  maxDelayMs: number;
  /** Max jitter in milliseconds, added randomly. */
  jitterMaxMs: number;
};

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  jitterMaxMs: 500,
};

/**
 * Compute exponential backoff delay: min(baseDelay * 2^attempt + jitter, maxDelay)
 */
export function computeBackoff(attempt: number, config: BackoffConfig, rng: () => number = Math.random): number {
  const jitter = Math.floor(rng() * config.jitterMaxMs);
  return Math.min(config.baseDelayMs * Math.pow(2, attempt) + jitter, config.maxDelayMs);
}

// ---------------------------------------------------------------------------
// DurableJobQueue config
// ---------------------------------------------------------------------------

export type DurableJobQueueConfig = {
  backoff?: Partial<BackoffConfig>;
  /** Heartbeat timeout in milliseconds. Default 120_000 (120s). */
  heartbeatTimeoutMs?: number;
  /** Default max attempts for jobs. Default 3. */
  defaultMaxAttempts?: number;
  /** Default job TTL in milliseconds. Default 30 minutes. */
  defaultTtlMs?: number;
  /** Per-type concurrency limits. Types not listed have no limit. */
  concurrency?: Partial<Record<JobType, number>>;
  /** Global concurrency limit (across all types). Default unlimited. */
  globalConcurrency?: number;
};

// ---------------------------------------------------------------------------
// DurableJobQueue
// ---------------------------------------------------------------------------

export class DurableJobQueue {
  private readonly store: JobStore;
  private readonly backoff: BackoffConfig;
  private readonly heartbeatTimeoutMs: number;
  private readonly defaultMaxAttempts: number;
  private readonly defaultTtlMs: number;
  private readonly concurrency: Partial<Record<JobType, number>>;
  private readonly globalConcurrency: number;

  readonly events = new JobEventEmitter();

  private readonly handlers = new Map<JobType, JobHandler>();
  private readonly activeJobs = new Map<string, { cancelled: boolean }>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reapTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(store: JobStore, config: DurableJobQueueConfig = {}) {
    this.store = store;
    this.backoff = { ...DEFAULT_BACKOFF, ...config.backoff };
    this.heartbeatTimeoutMs = config.heartbeatTimeoutMs ?? 120_000;
    this.defaultMaxAttempts = config.defaultMaxAttempts ?? 3;
    this.defaultTtlMs = config.defaultTtlMs ?? 30 * 60 * 1000;
    this.concurrency = config.concurrency ?? {};
    this.globalConcurrency = config.globalConcurrency ?? Infinity;
  }

  // -- Registration --------------------------------------------------------

  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  // -- Enqueue -------------------------------------------------------------

  async enqueue(input: {
    type: JobType;
    project_id: string;
    user_id: string;
    organization_id: string;
    payload: Record<string, unknown>;
    priority?: JobPriority;
    max_attempts?: number;
    ttlMs?: number;
  }): Promise<string> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const ttl = input.ttlMs ?? this.defaultTtlMs;

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
      max_attempts: input.max_attempts ?? this.defaultMaxAttempts,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttl).toISOString(),
      error_history: [],
    };

    await this.store.save(job);
    this.events.emit({ type: 'enqueued', job });
    return jobId;
  }

  // -- Dequeue / pickup ----------------------------------------------------

  /**
   * Pick up the next ready job(s) respecting concurrency limits.
   * Returns jobs that were transitioned to "processing".
   */
  async pickup(limit = 1): Promise<CodenJob[]> {
    const now = new Date().toISOString();
    const candidates = await this.store.findReady(limit * 3, now); // over-fetch to handle concurrency filtering
    const picked: CodenJob[] = [];

    for (const job of candidates) {
      if (picked.length >= limit) break;

      // Global concurrency check
      if (this.activeJobs.size >= this.globalConcurrency) break;

      // Per-type concurrency check
      const typeLimit = this.concurrency[job.type];
      if (typeLimit !== undefined) {
        const currentCount = await this.store.countProcessing(job.type);
        if (currentCount >= typeLimit) continue;
      }

      const nowTs = new Date().toISOString();
      await this.store.update(job.id, {
        status: 'processing',
        started_at: nowTs,
        last_heartbeat: nowTs,
        attempts: job.attempts + 1,
      });

      const updated = (await this.store.get(job.id))!;
      this.activeJobs.set(job.id, { cancelled: false });
      this.events.emit({ type: 'started', job: updated });
      picked.push(updated);
    }

    return picked;
  }

  // -- Execute -------------------------------------------------------------

  async execute(job: CodenJob): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      await this.failJob(job, `No handler registered for type: ${job.type}`, false);
      return;
    }

    const activeEntry = this.activeJobs.get(job.id) ?? { cancelled: false };
    this.activeJobs.set(job.id, activeEntry);

    const ctx: JobContext = {
      reportProgress: (percentage, step, message) => {
        const progress: JobProgress = {
          percentage: Math.max(0, Math.min(100, percentage)),
          step,
          message,
          updated_at: new Date().toISOString(),
        };
        this.store.update(job.id, { progress, last_heartbeat: new Date().toISOString() });
        this.events.emit({ type: 'progress', job, progress });
      },
      heartbeat: () => {
        this.store.update(job.id, { last_heartbeat: new Date().toISOString() });
      },
      isCancelled: () => activeEntry.cancelled,
    };

    try {
      const result = await handler(job as any, ctx);
      // Check if cancelled during execution
      if (activeEntry.cancelled) {
        return; // already handled by cancel()
      }
      await this.completeJob(job, result as Record<string, unknown>);
    } catch (err: any) {
      if (activeEntry.cancelled) return;
      const errorMsg = err?.message ?? String(err);
      const willRetry = job.attempts < job.max_attempts;
      await this.failJob(job, errorMsg, willRetry);
    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  // -- Complete / Fail / DLQ -----------------------------------------------

  private async completeJob(job: CodenJob, result: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    await this.store.update(job.id, {
      status: 'completed',
      result,
      completed_at: now,
      progress: { percentage: 100, step: 'done', updated_at: now },
    });
    const updated = (await this.store.get(job.id))!;
    this.events.emit({ type: 'completed', job: updated, result });
  }

  private async failJob(job: CodenJob, errorMsg: string, willRetry: boolean): Promise<void> {
    const current = (await this.store.get(job.id))!;
    const errorHistory: ErrorEntry[] = [
      ...(current.error_history ?? []),
      { attempt: current.attempts, message: errorMsg, timestamp: new Date().toISOString() },
    ];

    if (willRetry) {
      const backoffMs = computeBackoff(current.attempts - 1, this.backoff);
      const retryAfter = new Date(Date.now() + backoffMs).toISOString();
      await this.store.update(job.id, {
        status: 'pending',
        error: errorMsg,
        error_history: errorHistory,
        retry_after: retryAfter,
        last_heartbeat: undefined,
        started_at: undefined,
      });
      const updated = (await this.store.get(job.id))!;
      this.events.emit({ type: 'failed', job: updated, error: errorMsg, willRetry: true });
    } else {
      // Move to DLQ
      const now = new Date().toISOString();
      await this.store.update(job.id, {
        status: 'dead_letter',
        error: errorMsg,
        error_history: errorHistory,
        dlq_at: now,
        completed_at: now,
      });
      const updated = (await this.store.get(job.id))!;
      this.events.emit({ type: 'failed', job: updated, error: errorMsg, willRetry: false });
      this.events.emit({ type: 'dlq', job: updated, errorHistory });
    }
  }

  // -- Cancel --------------------------------------------------------------

  async cancel(jobId: string, userId?: string): Promise<boolean> {
    const job = await this.store.get(jobId);
    if (!job) return false;
    if (userId && job.user_id !== userId) return false;
    if (job.status !== 'pending' && job.status !== 'processing') return false;

    // Signal active execution to stop
    const activeEntry = this.activeJobs.get(jobId);
    if (activeEntry) activeEntry.cancelled = true;

    const now = new Date().toISOString();
    await this.store.update(jobId, {
      status: 'cancelled',
      completed_at: now,
    });
    const updated = (await this.store.get(jobId))!;
    this.activeJobs.delete(jobId);
    this.events.emit({ type: 'cancelled', job: updated });
    return true;
  }

  // -- Get job status ------------------------------------------------------

  async getJob(jobId: string): Promise<CodenJob | null> {
    return this.store.get(jobId);
  }

  // -- Stale job reaping ---------------------------------------------------

  /**
   * Find and recover stuck processing jobs.
   * Jobs whose last_heartbeat is older than heartbeatTimeoutMs are reset to pending
   * (if retries remain) or moved to DLQ.
   */
  async reapStaleJobs(): Promise<CodenJob[]> {
    const now = new Date();
    const stale = await this.store.findStale(this.heartbeatTimeoutMs, now.toISOString());
    const reaped: CodenJob[] = [];

    for (const job of stale) {
      const errorMsg = `Job stalled: no heartbeat for ${this.heartbeatTimeoutMs}ms`;
      const errorHistory: ErrorEntry[] = [
        ...(job.error_history ?? []),
        { attempt: job.attempts, message: errorMsg, timestamp: now.toISOString() },
      ];

      if (job.attempts < job.max_attempts) {
        const backoffMs = computeBackoff(job.attempts - 1, this.backoff);
        const retryAfter = new Date(now.getTime() + backoffMs).toISOString();
        await this.store.update(job.id, {
          status: 'pending',
          error: errorMsg,
          error_history: errorHistory,
          retry_after: retryAfter,
          last_heartbeat: undefined,
          started_at: undefined,
        });
      } else {
        await this.store.update(job.id, {
          status: 'dead_letter',
          error: errorMsg,
          error_history: errorHistory,
          dlq_at: now.toISOString(),
          completed_at: now.toISOString(),
        });
      }

      const updated = (await this.store.get(job.id))!;
      this.activeJobs.delete(job.id);
      this.events.emit({ type: 'reaped', job: updated });
      reaped.push(updated);
    }

    return reaped;
  }

  // -- DLQ -----------------------------------------------------------------

  async listDLQ(limit?: number): Promise<CodenJob[]> {
    return this.store.listDLQ(limit);
  }

  /**
   * Retry a job from the DLQ by resetting it to pending with fresh attempts.
   */
  async retryFromDLQ(jobId: string, extraAttempts = 3): Promise<boolean> {
    const job = await this.store.get(jobId);
    if (!job || job.status !== 'dead_letter') return false;
    await this.store.update(jobId, {
      status: 'pending',
      max_attempts: job.attempts + extraAttempts,
      retry_after: undefined,
      dlq_at: undefined,
      completed_at: undefined,
      error: undefined,
    });
    return true;
  }

  // -- Worker loop ---------------------------------------------------------

  /**
   * Start the background worker that polls for ready jobs and reaps stale ones.
   */
  start(pollIntervalMs = 2_000, reapIntervalMs = 30_000): void {
    if (this.running) return;
    this.running = true;

    this.pollTimer = setInterval(async () => {
      try {
        const jobs = await this.pickup();
        for (const job of jobs) {
          this.execute(job).catch(() => {});
        }
      } catch {
        // swallow poll errors
      }
    }, pollIntervalMs);

    this.reapTimer = setInterval(async () => {
      try {
        await this.reapStaleJobs();
      } catch {
        // swallow reap errors
      }
    }, reapIntervalMs);

    if (this.pollTimer && typeof this.pollTimer === 'object' && 'unref' in this.pollTimer) {
      (this.pollTimer as { unref: () => void }).unref();
    }
    if (this.reapTimer && typeof this.reapTimer === 'object' && 'unref' in this.reapTimer) {
      (this.reapTimer as { unref: () => void }).unref();
    }
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.reapTimer) {
      clearInterval(this.reapTimer);
      this.reapTimer = null;
    }
    this.running = false;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Expose active job count for testing. */
  get activeCount(): number {
    return this.activeJobs.size;
  }
}
