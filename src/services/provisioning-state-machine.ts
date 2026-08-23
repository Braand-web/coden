// Provisioning State Machine — idempotent, resumable per-app infrastructure
// provisioning.
//
// Closes a gap in the existing Coden Cloud stack: `coden-cloud.ts` *detects*
// backend needs and `supabase-provisioning.ts` *applies* a migration, but there
// was no durable, resumable orchestration with:
//   - an explicit lifecycle (pending → provisioning → migrating → ready / failed …)
//   - idempotency keys so a retried request never double-provisions
//   - resume-from-last-validated-step after an interruption
//   - locking so two runs can't mutate the same project concurrently
//
// This module is PURE: no I/O, no secrets. It computes *what* to do and folds
// step results into state. The actual side effects (Supabase Management API,
// storage buckets, etc.) are executed by the caller, which reports each step
// result back into `advanceProvisioning`. The result object NEVER carries a
// private secret (see assertNoSecretsInPublicConfig).

// ───────────────────────────────────────────────────────────────────────────
// Lifecycle
// ───────────────────────────────────────────────────────────────────────────

export type ProvisioningState =
  | 'pending'
  | 'provisioning'
  | 'migrating'
  | 'ready'
  | 'failed'
  | 'suspended'
  | 'deleting'
  | 'deleted';

export const PROVISIONING_STATES: readonly ProvisioningState[] = [
  'pending',
  'provisioning',
  'migrating',
  'ready',
  'failed',
  'suspended',
  'deleting',
  'deleted',
];

/** Terminal states never advance further on their own. */
export const TERMINAL_PROVISIONING_STATES: readonly ProvisioningState[] = ['ready', 'deleted'];

export type ProvisioningEnvironment = 'development' | 'production';

export type ProvisioningCapabilities = {
  database: boolean;
  authentication: boolean;
  storage: boolean;
  realtime: boolean;
  scheduledJobs: boolean;
  serverFunctions: boolean;
};

export type AppInfrastructureRequest = {
  projectId: string;
  environment: ProvisioningEnvironment;
  capabilities: ProvisioningCapabilities;
  schemaVersion: string;
  /** Stable key so a retried request resolves to the same run (see deriveIdempotencyKey). */
  idempotencyKey: string;
};

export type AppInfrastructureResult = {
  projectId: string;
  state: ProvisioningState;
  /** Public, browser-safe config only — never a private secret. */
  publicConfiguration: Record<string, string>;
  appliedSchemaVersion?: string;
  errorCode?: string;
  errorMessage?: string;
};

// ───────────────────────────────────────────────────────────────────────────
// Steps — the ordered work a provisioning run performs
// ───────────────────────────────────────────────────────────────────────────

export type ProvisioningStepKey =
  | 'create_record'
  | 'allocate_infrastructure'
  | 'configure_public_runtime'
  | 'store_secrets'
  | 'run_migrations'
  | 'apply_security_policies'
  | 'create_storage'
  | 'configure_functions'
  | 'health_check';

export type ProvisioningStep = {
  key: ProvisioningStepKey;
  /** User-facing label (FR) shown in the progress UI. */
  label: string;
  /** Lifecycle state the run sits in while this step runs. */
  phase: Extract<ProvisioningState, 'provisioning' | 'migrating'>;
  /** Only included when the relevant capability is requested. */
  requires?: keyof ProvisioningCapabilities;
};

const ALL_STEPS: readonly ProvisioningStep[] = [
  { key: 'create_record', label: 'Préparation du backend', phase: 'provisioning' },
  { key: 'allocate_infrastructure', label: 'Création de la base de données', phase: 'provisioning', requires: 'database' },
  { key: 'configure_public_runtime', label: 'Configuration des variables publiques', phase: 'provisioning' },
  { key: 'store_secrets', label: 'Sécurisation des secrets', phase: 'provisioning' },
  { key: 'run_migrations', label: 'Application des migrations', phase: 'migrating', requires: 'database' },
  { key: 'apply_security_policies', label: 'Application des règles de sécurité', phase: 'migrating', requires: 'database' },
  { key: 'create_storage', label: 'Configuration du stockage', phase: 'provisioning', requires: 'storage' },
  { key: 'configure_functions', label: 'Configuration des fonctions serveur', phase: 'provisioning', requires: 'serverFunctions' },
  { key: 'health_check', label: "Vérification de l'infrastructure", phase: 'provisioning' },
];

/**
 * The ordered steps required for a given capability set. Steps gated by a
 * capability are skipped when that capability is not requested. `create_record`,
 * `configure_public_runtime`, `store_secrets` and `health_check` always run.
 */
export function planProvisioningSteps(capabilities: ProvisioningCapabilities): ProvisioningStep[] {
  return ALL_STEPS.filter(step => !step.requires || capabilities[step.requires]);
}

// ───────────────────────────────────────────────────────────────────────────
// Idempotency
// ───────────────────────────────────────────────────────────────────────────

/**
 * Derive a stable idempotency key from the immutable projectId + operation +
 * schema version. Two identical requests produce the same key, so a retry
 * resolves to the *same* run instead of provisioning twice. Intentionally does
 * NOT include a timestamp or random value.
 */
export function deriveIdempotencyKey(
  projectId: string,
  operation: 'provision' | 'migrate' | 'delete',
  schemaVersion: string,
): string {
  const safe = (value: string) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return `${safe(projectId)}:${operation}:${safe(schemaVersion)}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Run record (what a caller persists; this module never persists it)
// ───────────────────────────────────────────────────────────────────────────

export type ProvisioningStepStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export type ProvisioningStepRecord = {
  key: ProvisioningStepKey;
  label: string;
  status: ProvisioningStepStatus;
  errorCode?: string;
  errorMessage?: string;
};

export type ProvisioningRun = {
  projectId: string;
  idempotencyKey: string;
  environment: ProvisioningEnvironment;
  schemaVersion: string;
  state: ProvisioningState;
  steps: ProvisioningStepRecord[];
  publicConfiguration: Record<string, string>;
  /** Process/worker id holding the lock, if any. */
  lockedBy?: string;
  /** Epoch ms when the lock was taken (for stale-lock detection). */
  lockedAt?: number;
  errorCode?: string;
  errorMessage?: string;
};

/** Build the initial pending run for a request. Pure & deterministic. */
export function createProvisioningRun(request: AppInfrastructureRequest): ProvisioningRun {
  const steps = planProvisioningSteps(request.capabilities).map<ProvisioningStepRecord>(step => ({
    key: step.key,
    label: step.label,
    status: 'pending',
  }));
  return {
    projectId: request.projectId,
    idempotencyKey: request.idempotencyKey,
    environment: request.environment,
    schemaVersion: request.schemaVersion,
    state: 'pending',
    steps,
    publicConfiguration: {},
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Locking
// ───────────────────────────────────────────────────────────────────────────

export const DEFAULT_PROVISIONING_LOCK_TTL_MS = 5 * 60_000;

export type LockResult =
  | { ok: true; run: ProvisioningRun }
  | { ok: false; reason: 'locked_by_other'; lockedBy?: string };

/**
 * Acquire the provisioning lock for a worker. Idempotent for the same worker.
 * A lock older than `ttlMs` is considered stale and can be taken over — this is
 * what lets provisioning resume after a crashed worker.
 */
export function acquireProvisioningLock(
  run: ProvisioningRun,
  workerId: string,
  now = Date.now(),
  ttlMs = DEFAULT_PROVISIONING_LOCK_TTL_MS,
): LockResult {
  const held = Boolean(run.lockedBy) && run.lockedBy !== workerId;
  const fresh = typeof run.lockedAt === 'number' && now - run.lockedAt < ttlMs;
  if (held && fresh) {
    return { ok: false, reason: 'locked_by_other', lockedBy: run.lockedBy };
  }
  return { ok: true, run: { ...run, lockedBy: workerId, lockedAt: now } };
}

export function releaseProvisioningLock(run: ProvisioningRun, workerId: string): ProvisioningRun {
  if (run.lockedBy && run.lockedBy !== workerId) return run; // not ours, leave it
  const { lockedBy: _lockedBy, lockedAt: _lockedAt, ...rest } = run;
  return rest;
}

// ───────────────────────────────────────────────────────────────────────────
// Resume — find the next step that still needs to run
// ───────────────────────────────────────────────────────────────────────────

/**
 * The next actionable step after an interruption: the first step that is not
 * already `done` or `skipped`. Returns null when every step is finished. This
 * is the heart of "resume from the last validated step instead of recreating
 * the whole infrastructure".
 */
export function nextProvisioningStep(run: ProvisioningRun): ProvisioningStepRecord | null {
  return run.steps.find(step => step.status !== 'done' && step.status !== 'skipped') ?? null;
}

export type StepOutcome =
  | { status: 'done'; publicConfiguration?: Record<string, string> }
  | { status: 'skipped' }
  | { status: 'failed'; errorCode: string; errorMessage: string };

/**
 * Fold a single step outcome into the run. Pure reducer:
 *   - marks the step done/skipped/failed
 *   - merges any public (browser-safe) config the step produced
 *   - recomputes the overall lifecycle state
 * A failed step moves the whole run to `failed` and stops. When all steps are
 * done, the run becomes `ready`.
 */
export function advanceProvisioning(run: ProvisioningRun, stepKey: ProvisioningStepKey, outcome: StepOutcome): ProvisioningRun {
  const idx = run.steps.findIndex(step => step.key === stepKey);
  if (idx === -1) return run; // unknown step — ignore (idempotent / defensive)

  const steps = run.steps.slice();
  if (outcome.status === 'failed') {
    steps[idx] = { ...steps[idx], status: 'failed', errorCode: outcome.errorCode, errorMessage: outcome.errorMessage };
    return {
      ...run,
      steps,
      state: 'failed',
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
    };
  }

  steps[idx] = { ...steps[idx], status: outcome.status, errorCode: undefined, errorMessage: undefined };

  let publicConfiguration = run.publicConfiguration;
  if (outcome.status === 'done' && outcome.publicConfiguration) {
    assertNoSecretsInPublicConfig(outcome.publicConfiguration);
    publicConfiguration = { ...publicConfiguration, ...outcome.publicConfiguration };
  }

  const allFinished = steps.every(step => step.status === 'done' || step.status === 'skipped');
  const anyMigrating = steps.some(step => step.status === 'active' && isMigrationStep(step.key));
  let state: ProvisioningState;
  if (allFinished) {
    state = 'ready';
  } else if (anyMigrating) {
    state = 'migrating';
  } else {
    state = 'provisioning';
  }

  return { ...run, steps, publicConfiguration, state, errorCode: undefined, errorMessage: undefined };
}

/** Mark the next step active (so the UI can show it running). Pure. */
export function beginNextProvisioningStep(run: ProvisioningRun): ProvisioningRun {
  const next = nextProvisioningStep(run);
  if (!next) return run;
  const steps = run.steps.map(step => (step.key === next.key ? { ...step, status: 'active' as const } : step));
  const phase = isMigrationStep(next.key) ? 'migrating' : 'provisioning';
  return { ...run, steps, state: phase };
}

function isMigrationStep(key: ProvisioningStepKey): boolean {
  return key === 'run_migrations' || key === 'apply_security_policies';
}

// ───────────────────────────────────────────────────────────────────────────
// Public result projection + secret safety
// ───────────────────────────────────────────────────────────────────────────

const SECRET_KEY_PATTERN = /(secret|service_role|private|password|token|api[_-]?key)/i;
const SECRET_VALUE_PATTERN = /\b(sbp_[A-Za-z0-9]+|sk-[A-Za-z0-9]+|eyJ[A-Za-z0-9._-]{20,})/;

/**
 * Guards the "the result must never contain a private secret" rule. Throws if a
 * key looks secret-like or a value looks like a known secret format. Service
 * role keys, management tokens and the like must stay server-side.
 */
export function assertNoSecretsInPublicConfig(config: Record<string, string>): void {
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new Error(`SECRET_IN_PUBLIC_CONFIG: key "${key}" looks like a secret and must stay server-side`);
    }
    if (typeof value === 'string' && SECRET_VALUE_PATTERN.test(value)) {
      throw new Error(`SECRET_IN_PUBLIC_CONFIG: value for "${key}" looks like a secret credential`);
    }
  }
}

/** Project a run into the browser-safe result contract. */
export function toInfrastructureResult(run: ProvisioningRun): AppInfrastructureResult {
  assertNoSecretsInPublicConfig(run.publicConfiguration);
  const result: AppInfrastructureResult = {
    projectId: run.projectId,
    state: run.state,
    publicConfiguration: { ...run.publicConfiguration },
  };
  if (run.state === 'ready') result.appliedSchemaVersion = run.schemaVersion;
  if (run.errorCode) result.errorCode = run.errorCode;
  if (run.errorMessage) result.errorMessage = run.errorMessage;
  return result;
}

/** True when the backend is usable by the app. The UI must gate on this. */
export function isBackendReady(run: ProvisioningRun): boolean {
  return run.state === 'ready';
}
