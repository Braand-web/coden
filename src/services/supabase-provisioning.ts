// Supabase Management API provisioning service.
//
// Closes the gap where Coden *generates* a backend migration (supabase/schema.sql,
// supabase/migrations/*.sql) but never *applies* it to a real Supabase project.
// This service applies a generated migration to a target project via the Supabase
// Management API.
//
// SECURITY CONTRACT
// - The Management token is the most privileged Supabase credential (full account
//   access). It is read from the environment at call time and must NEVER be
//   hardcoded, returned to clients, or written to generated files.
// - Token values are redacted from every error/log surface (redactManagementToken).
// - Safe by default: dry-run is the default, and destructive statements
//   (drop/truncate/delete-without-where/drop column) are refused unless the caller
//   explicitly opts in with allowDestructive.

export const MANAGEMENT_API_BASE = 'https://api.supabase.com/v1';

export type MigrationSafety = {
  destructive: boolean;
  statements: number;
  flagged: string[];
};

const DESTRUCTIVE_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'drop table', re: /\bdrop\s+table\b/i },
  { label: 'drop schema', re: /\bdrop\s+schema\b/i },
  { label: 'drop database', re: /\bdrop\s+database\b/i },
  { label: 'drop column', re: /\bdrop\s+column\b/i },
  { label: 'truncate', re: /\btruncate\b/i },
  // DELETE FROM ... with no WHERE clause anywhere after it.
  { label: 'delete without where', re: /\bdelete\s+from\b(?![\s\S]*?\bwhere\b)/i },
];

export function classifyMigrationSafety(sql: string): MigrationSafety {
  const text = String(sql || '');
  const flagged = DESTRUCTIVE_PATTERNS.filter(pattern => pattern.re.test(text)).map(pattern => pattern.label);
  const statements = text
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean).length;
  return { destructive: flagged.length > 0, statements, flagged };
}

// Supabase project refs are 20-char lowercase alphanumeric identifiers.
export function isValidProjectRef(ref: string): boolean {
  return /^[a-z0-9]{20}$/.test(String(ref || ''));
}

export function redactManagementToken(value: string): string {
  return String(value || '')
    .replace(/sbp_[A-Za-z0-9]+/g, 'sbp_***REDACTED***')
    .replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, '$1***REDACTED***');
}

export function resolveManagementToken(explicit?: string): string {
  return (
    explicit ||
    process.env.CODEN_SUPABASE_MGMT_TOKEN ||
    process.env.SUPABASE_MANAGEMENT_TOKEN ||
    process.env.SUPABASE_ACCESS_TOKEN ||
    ''
  );
}

export type ApplyMigrationRequest = {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
};

export function buildApplyMigrationRequest(input: { projectRef: string; sql: string; token: string }): ApplyMigrationRequest {
  if (!isValidProjectRef(input.projectRef)) throw new Error('INVALID_PROJECT_REF');
  if (!input.sql || !input.sql.trim()) throw new Error('EMPTY_MIGRATION');
  if (!input.token || !/^sbp_/.test(input.token)) throw new Error('INVALID_MANAGEMENT_TOKEN');
  return {
    url: `${MANAGEMENT_API_BASE}/projects/${input.projectRef}/database/query`,
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query: input.sql }),
  };
}

export type ApplyMigrationOptions = {
  projectRef: string;
  sql: string;
  token?: string;
  allowDestructive?: boolean;
  /** Defaults to true. When true, the migration is validated but never executed. */
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
};

export type ApplyMigrationResult = {
  applied: boolean;
  dryRun: boolean;
  safety: MigrationSafety;
  status?: number;
  error?: string;
};

export async function applyGeneratedMigration(options: ApplyMigrationOptions): Promise<ApplyMigrationResult> {
  const safety = classifyMigrationSafety(options.sql);
  const dryRun = options.dryRun !== false; // safe default: dry-run unless explicitly disabled

  if (safety.destructive && !options.allowDestructive) {
    return {
      applied: false,
      dryRun,
      safety,
      error: `Refused: destructive operations detected (${safety.flagged.join(', ')}). Re-run with allowDestructive to override.`,
    };
  }

  if (dryRun) {
    return { applied: false, dryRun: true, safety };
  }

  const token = resolveManagementToken(options.token);
  if (!token) {
    return { applied: false, dryRun, safety, error: 'MISSING_MANAGEMENT_TOKEN' };
  }

  let request: ApplyMigrationRequest;
  try {
    request = buildApplyMigrationRequest({ projectRef: options.projectRef, sql: options.sql, token });
  } catch (error) {
    return { applied: false, dryRun, safety, error: redactManagementToken((error as Error).message || 'INVALID_REQUEST') };
  }

  const doFetch = options.fetchImpl || fetch;
  try {
    const response = await doFetch(request.url, { method: request.method, headers: request.headers, body: request.body });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        applied: false,
        dryRun: false,
        safety,
        status: response.status,
        error: redactManagementToken(text).slice(0, 500) || `HTTP ${response.status}`,
      };
    }
    return { applied: true, dryRun: false, safety, status: response.status };
  } catch (error) {
    return { applied: false, dryRun: false, safety, error: redactManagementToken((error as Error).message || 'NETWORK_ERROR') };
  }
}

// ── Publish-flow wiring ──────────────────────────────────────────────────────
// Helpers to pick the right migration and target project ref so the publish
// flow can actually apply the generated backend (closing the gap where
// supabase/schema.sql was generated but never run).

export type ProjectFileLike = { path: string; content: string };

const MIGRATION_PRIORITY = [
  'supabase/migrations/0001_coden_fullstack.sql',
  'supabase/schema.sql',
];

/** Pick the SQL migration to apply from a project's files (versioned first). */
export function selectMigrationFromFiles(files: ProjectFileLike[]): ProjectFileLike | null {
  if (!Array.isArray(files)) return null;
  const norm = (p: string) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  for (const wanted of MIGRATION_PRIORITY) {
    const found = files.find(f => norm(f.path) === wanted);
    if (found && found.content && found.content.trim()) return found;
  }
  // Any other .sql under supabase/ as a fallback.
  const anySql = files.find(f => /^supabase\/.+\.sql$/.test(norm(f.path)) && f.content && f.content.trim());
  return anySql || null;
}

/** Resolve a Supabase project ref from a stored runtime/cloud config. */
export function resolveProjectRef(config: Record<string, unknown> | null | undefined): string | null {
  if (!config) return null;
  const candidates = [
    (config as any).project_ref,
    (config as any).projectRef,
    (config as any).ref,
    (config as any).supabase_project_ref,
  ].map(v => String(v || '').trim()).filter(Boolean);
  // Or derive from a supabase URL like https://abcdefghij0123456789.supabase.co
  const url = String((config as any).supabaseUrl || (config as any).supabase_url || (config as any).url || '');
  const fromUrl = url.match(/https?:\/\/([a-z0-9]{20})\.supabase\.co/i)?.[1];
  if (fromUrl) candidates.push(fromUrl);
  const ref = candidates.find(isValidProjectRef);
  return ref || null;
}

export type PublishProvisionInput = {
  files: ProjectFileLike[];
  cloudConfig?: Record<string, unknown> | null;
  token?: string;
  allowDestructive?: boolean;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
};

export type PublishProvisionResult = ApplyMigrationResult & { skipped?: boolean; reason?: string };

/**
 * Orchestrates migration application during publish. Safe by default: skips
 * cleanly (never throws) when there is no migration, no project ref, or no
 * management token configured.
 */
export async function provisionOnPublish(input: PublishProvisionInput): Promise<PublishProvisionResult> {
  const migration = selectMigrationFromFiles(input.files);
  if (!migration) {
    return { applied: false, dryRun: input.dryRun !== false, safety: classifyMigrationSafety(''), skipped: true, reason: 'no_migration' };
  }
  const projectRef = resolveProjectRef(input.cloudConfig);
  if (!projectRef) {
    return { applied: false, dryRun: input.dryRun !== false, safety: classifyMigrationSafety(migration.content), skipped: true, reason: 'no_project_ref' };
  }
  const token = resolveManagementToken(input.token);
  if (!token) {
    return { applied: false, dryRun: input.dryRun !== false, safety: classifyMigrationSafety(migration.content), skipped: true, reason: 'no_management_token' };
  }
  return applyGeneratedMigration({
    projectRef,
    sql: migration.content,
    token,
    allowDestructive: input.allowDestructive,
    dryRun: input.dryRun,
    fetchImpl: input.fetchImpl,
  });
}
