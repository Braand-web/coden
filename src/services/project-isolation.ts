// Project Isolation — the immutable projectId boundary that guarantees two
// generated applications can NEVER read or write each other's data.
//
// Every provisioned resource (schema, table, storage prefix, secret namespace,
// realtime channel) is bound to a single immutable projectId. This module is the
// single chokepoint that:
//   - validates a projectId is well-formed and treats it as immutable
//   - derives per-project, collision-free resource names
//   - decides whether an actor scoped to project A may touch a resource owned by
//     project B (answer: only when A === B)
//
// Pure & dependency-free so it can be unit-tested exhaustively (see
// test-project-isolation.ts) — the isolation guarantee is proven by tests, not
// asserted by prose.

export type IsolatedResourceKind =
  | 'schema'
  | 'table'
  | 'storage_prefix'
  | 'secret_namespace'
  | 'realtime_channel'
  | 'function_prefix';

/** A resource tagged with the project that owns it. */
export type ScopedResource = {
  projectId: string;
  kind: IsolatedResourceKind;
  name: string;
};

const PROJECT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/;

/** A projectId must be present, well-formed and stable. Throws otherwise. */
export function assertValidProjectId(projectId: unknown): asserts projectId is string {
  if (typeof projectId !== 'string' || !PROJECT_ID_RE.test(projectId)) {
    throw new Error('INVALID_PROJECT_ID');
  }
}

export function isValidProjectId(projectId: unknown): projectId is string {
  return typeof projectId === 'string' && PROJECT_ID_RE.test(projectId);
}

/**
 * Treat projectId as immutable: once a resource is created with a projectId, any
 * attempt to "reassign" it to a different projectId is a hard error. Returns the
 * unchanged id when they match.
 */
export function assertImmutableProjectId(current: string, incoming: string): string {
  assertValidProjectId(current);
  assertValidProjectId(incoming);
  if (current !== incoming) {
    throw new Error('PROJECT_ID_IMMUTABLE: cannot reassign a resource to a different project');
  }
  return current;
}

/** Normalize a projectId into a Postgres/identifier-safe slug fragment. */
function slug(projectId: string): string {
  assertValidProjectId(projectId);
  return projectId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'project';
}

const KIND_PREFIX: Record<IsolatedResourceKind, string> = {
  schema: 'app',
  table: 'app',
  storage_prefix: 'app',
  secret_namespace: 'secret',
  realtime_channel: 'rt',
  function_prefix: 'fn',
};

/**
 * Derive a deterministic, per-project, collision-free resource name. Two
 * different projects always produce different names; the same project always
 * produces the same name (idempotent).
 */
export function buildIsolatedResourceName(projectId: string, kind: IsolatedResourceKind, suffix?: string): string {
  const base = `${KIND_PREFIX[kind]}_${slug(projectId)}`;
  if (!suffix) return base;
  const safeSuffix = String(suffix).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return safeSuffix ? `${base}__${safeSuffix}` : base;
}

/** Tag a resource with its owning project. */
export function scopeResource(projectId: string, kind: IsolatedResourceKind, suffix?: string): ScopedResource {
  assertValidProjectId(projectId);
  return { projectId, kind, name: buildIsolatedResourceName(projectId, kind, suffix) };
}

/**
 * The core isolation decision: an actor scoped to `actorProjectId` may access
 * `resource` ONLY when it belongs to the same project. This is deny-by-default —
 * any mismatch, or any malformed id, returns false.
 */
export function canAccessResource(actorProjectId: string, resource: ScopedResource): boolean {
  if (!isValidProjectId(actorProjectId) || !isValidProjectId(resource.projectId)) return false;
  return actorProjectId === resource.projectId;
}

/** Throwing variant for server-side enforcement at a trust boundary. */
export function assertResourceAccess(actorProjectId: string, resource: ScopedResource): void {
  if (!canAccessResource(actorProjectId, resource)) {
    throw new Error('CROSS_PROJECT_ACCESS_DENIED');
  }
}

/**
 * Filter a heterogeneous list of scoped resources down to only those the actor's
 * project may see. Used to harden any list/query path so a bug elsewhere cannot
 * leak another project's rows.
 */
export function filterAccessibleResources<T extends ScopedResource>(actorProjectId: string, resources: T[]): T[] {
  if (!isValidProjectId(actorProjectId)) return [];
  return resources.filter(resource => canAccessResource(actorProjectId, resource));
}

/**
 * Validate that a SQL query / row payload is correctly scoped to a project. The
 * caller passes the projectId column value found on the row and the expected
 * projectId; mismatches are rejected. Defends the "never rely on UI filtering"
 * rule by re-checking at the data layer.
 */
export function assertRowBelongsToProject(rowProjectId: unknown, expectedProjectId: string): void {
  assertValidProjectId(expectedProjectId);
  if (rowProjectId !== expectedProjectId) {
    throw new Error('ROW_PROJECT_MISMATCH');
  }
}
