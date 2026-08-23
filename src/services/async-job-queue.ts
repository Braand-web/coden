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
};

export type JobHandler<TPayload = Record<string, unknown>, TResult = Record<string, unknown>> = (
  job: CodenJob & { payload: TPayload },
  onProgress?: (step: string, message: string) => void,
) => Promise<TResult>;

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
};

const queue: QueueState = {
  handlers: new Map(),
  activeJobs: new Map(),
  isRunning: false,
  pollTimer: null,
  supabase: null,
};

/**
 * Initialize the job queue with a Supabase client.
 * Call this once at server startup.
 */
export function initJobQueue(supabaseClient: any): void {
  queue.supabase = supabaseClient;
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
export async function enqueueJob(input: {
  type: CodenJob['type'];
  project_id: string;
  user_id: string;
  organization_id: string;
  payload: Record<string, unknown>;
  priority?: JobPriority;
  max_attempts?: number;
}): Promise<string> {
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
    await queue.supabase.from('agent_jobs').insert(job).catch((err: any) => {
      console.warn('[coden:job_queue_persist_failed]', { jobId, message: err?.message });
    });
  } else {
    // Fallback: in-memory execution (no persistence, but still async)
    queueMicrotask(() => executeJobInProcess(job));
  }

  return jobId;
}

/**
 * Get the current status of a job.
 */
export async function getJobStatus(jobId: string): Promise<CodenJob | null> {
  if (!queue.supabase) return null;
  const { data } = await queue.supabase
    .from('agent_jobs')
    .select('*')
    .eq('id', jobId)
    .single();
  return data as CodenJob | null;
}

/**
 * Cancel a pending or processing job.
 */
export async function cancelJob(jobId: string, userId: string): Promise<boolean> {
  if (!queue.supabase) return false;
  const { error } = await queue.supabase
    .from('agent_jobs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('user_id', userId)
    .in('status', ['pending', 'processing']);
  return !error;
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
    if (queue.activeJobs.size >= MAX_CONCURRENT_JOBS) return;
    await pickupAndExecuteJobs();
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
  console.log('[coden:job_queue] Worker stopped');
}

async function pickupAndExecuteJobs(): Promise<void> {
  if (!queue.supabase) return;

  const available = MAX_CONCURRENT_JOBS - queue.activeJobs.size;
  if (available <= 0) return;

  // Pickup pending jobs, highest priority first
  const { data: jobs } = await queue.supabase
    .from('agent_jobs')
    .select('*')
    .eq('status', 'pending')
    .lt('expires_at', new Date(Date.now() + JOB_TTL_MS).toISOString()) // not expired
    .gt('expires_at', new Date().toISOString())                          // not expired
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(available);

  if (!jobs?.length) return;

  for (const job of jobs as CodenJob[]) {
    if (queue.activeJobs.has(job.id)) continue;
    const execution = executeJobInProcess(job);
    queue.activeJobs.set(job.id, execution);
    execution.finally(() => queue.activeJobs.delete(job.id));
  }
}

async function executeJobInProcess(job: CodenJob): Promise<void> {
  const handler = queue.handlers.get(job.type);
  if (!handler) {
    console.warn('[coden:job_queue] No handler for job type:', job.type);
    await updateJobStatus(job.id, 'failed', undefined, `No handler registered for type: ${job.type}`);
    return;
  }

  // Mark as processing
  await updateJobStatus(job.id, 'processing');

  const onProgress = (step: string, message: string) => {
    // Progress events are written to agent_job_events table for SSE polling
    if (queue.supabase) {
      queue.supabase.from('agent_job_events').insert({
        job_id: job.id,
        step,
        message,
        created_at: new Date().toISOString(),
      }).catch(() => null);
    }
  };

  try {
    const result = await handler(job as any, onProgress);
    await updateJobStatus(job.id, 'completed', result as Record<string, unknown>);
  } catch (err: any) {
    const attempts = job.attempts + 1;
    if (attempts < job.max_attempts) {
      // Retry: back to pending with incremented attempts
      await queue.supabase?.from('agent_jobs')
        .update({ status: 'pending', attempts, error: err?.message })
        .eq('id', job.id)
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
  await queue.supabase.from('agent_jobs').update(update).eq('id', jobId).catch(() => null);
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
