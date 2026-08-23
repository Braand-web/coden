// Supabase Management API — full per-app project provisioning.
//
// Creates a brand-new Supabase project (DB + Auth + Storage) for each Coden app,
// applies the generated migration, and creates a default storage bucket.
//
// SECURITY
// - Token is read from CODEN_SUPABASE_MGMT_TOKEN (preferred) or fallbacks.
// - Token is NEVER returned in responses; only project ref, url, anon key
//   (publishable) and service_role are exposed to the caller. Caller decides
//   whether to redact service_role before sending to the client.

import {
  applyGeneratedMigration,
  classifyMigrationSafety,
  isValidProjectRef,
  redactManagementToken,
  selectMigrationFromFiles,
  type ProjectFileLike,
} from './supabase-provisioning';

const MGMT = 'https://api.supabase.com/v1';

export type SupabaseProvisionConfig = {
  organizationId?: string;
  region?: string;
  dbPassword?: string;
  plan?: 'free' | 'pro';
  token?: string;
};

export type SupabaseProvisionedProject = {
  ref: string;
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  region: string;
  organizationId: string;
  status: 'ACTIVE_HEALTHY' | 'COMING_UP' | 'UNKNOWN' | string;
  createdAt: string;
};

export type ProvisionAppBackendResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  project?: SupabaseProvisionedProject;
  migration?: { applied: boolean; statements: number; error?: string };
  storage?: { bucket: string; created: boolean; error?: string };
  error?: string;
};

function resolveToken(explicit?: string): string {
  return (
    explicit ||
    process.env.CODEN_SUPABASE_MGMT_TOKEN ||
    process.env.SUPABASE_MANAGEMENT_TOKEN ||
    process.env.SUPABASE_ACCESS_TOKEN ||
    ''
  );
}

function genPassword(): string {
  // 32 chars, alnum + symbols Supabase accepts.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^*_-';
  const bytes = new Uint8Array(32);
  (globalThis.crypto || require('node:crypto').webcrypto).getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

async function mgmtFetch(
  path: string,
  init: { method: string; token: string; body?: unknown; fetchImpl?: typeof fetch },
): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  const doFetch = init.fetchImpl || fetch;
  const res = await doFetch(`${MGMT}${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${init.token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text().catch(() => '');
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: res.ok, status: res.status, data, text };
}

export async function listOrganizations(token: string, fetchImpl?: typeof fetch): Promise<Array<{ id: string; name: string }>> {
  const res = await mgmtFetch('/organizations', { method: 'GET', token, fetchImpl });
  if (!res.ok) throw new Error(`list_orgs_failed: ${res.status} ${redactManagementToken(res.text).slice(0, 200)}`);
  return Array.isArray(res.data) ? res.data : [];
}

export async function createSupabaseProject(input: {
  name: string;
  organizationId: string;
  region?: string;
  dbPassword?: string;
  plan?: 'free' | 'pro';
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<SupabaseProvisionedProject> {
  const body = {
    name: input.name.slice(0, 56),
    organization_id: input.organizationId,
    region: input.region || 'eu-west-2',
    plan: input.plan || 'free',
    db_pass: input.dbPassword || genPassword(),
  };
  const res = await mgmtFetch('/projects', { method: 'POST', token: input.token, body, fetchImpl: input.fetchImpl });
  if (!res.ok || !res.data?.id) {
    throw new Error(`create_project_failed: ${res.status} ${redactManagementToken(res.text).slice(0, 300)}`);
  }
  const ref = String(res.data.id || res.data.ref || '');
  if (!isValidProjectRef(ref)) throw new Error(`invalid_project_ref_returned: ${ref}`);
  // Pull API keys (anon + service_role).
  const keys = await fetchProjectApiKeys(ref, input.token, input.fetchImpl);
  return {
    ref,
    url: `https://${ref}.supabase.co`,
    anonKey: keys.anon,
    serviceRoleKey: keys.serviceRole,
    region: body.region,
    organizationId: input.organizationId,
    status: String(res.data.status || 'COMING_UP'),
    createdAt: new Date().toISOString(),
  };
}

export async function fetchProjectApiKeys(
  ref: string,
  token: string,
  fetchImpl?: typeof fetch,
): Promise<{ anon: string; serviceRole: string }> {
  // Retry: keys can take a few seconds to materialise on a brand-new project.
  let lastErr = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await mgmtFetch(`/projects/${ref}/api-keys`, { method: 'GET', token, fetchImpl });
    if (res.ok && Array.isArray(res.data)) {
      const anon = res.data.find((k: any) => k.name === 'anon')?.api_key || '';
      const serviceRole = res.data.find((k: any) => k.name === 'service_role')?.api_key || '';
      if (anon && serviceRole) return { anon, serviceRole };
      lastErr = 'keys_not_ready';
    } else {
      lastErr = `${res.status} ${res.text.slice(0, 120)}`;
    }
    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`fetch_api_keys_failed: ${redactManagementToken(lastErr)}`);
}

export async function createDefaultStorageBucket(input: {
  ref: string;
  serviceRoleKey: string;
  bucket?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ created: boolean; bucket: string; error?: string }> {
  const bucket = input.bucket || 'app-uploads';
  const doFetch = input.fetchImpl || fetch;
  // Storage API is project-scoped (not Management API): use the project URL.
  const url = `https://${input.ref}.supabase.co/storage/v1/bucket`;
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.serviceRoleKey}`,
        apikey: input.serviceRoleKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: bucket, name: bucket, public: false }),
    });
    if (res.ok) return { created: true, bucket };
    const text = await res.text().catch(() => '');
    if (res.status === 409 || /already exists/i.test(text)) return { created: false, bucket };
    return { created: false, bucket, error: `${res.status} ${text.slice(0, 200)}` };
  } catch (error) {
    return { created: false, bucket, error: (error as Error).message };
  }
}

/**
 * High-level orchestrator: provisions a fresh Supabase project for a Coden app,
 * applies the generated migration, and creates a default storage bucket.
 * Non-throwing: returns `{ ok: false, reason }` on configuration gaps so callers
 * can call this best-effort without breaking the project-create flow.
 */
export async function provisionAppBackend(input: {
  appName: string;
  files?: ProjectFileLike[];
  config?: SupabaseProvisionConfig;
  fetchImpl?: typeof fetch;
}): Promise<ProvisionAppBackendResult> {
  const token = resolveToken(input.config?.token);
  if (!token || !/^sbp_/.test(token)) {
    return { ok: false, skipped: true, reason: 'no_management_token' };
  }

  let organizationId = input.config?.organizationId || process.env.CODEN_SUPABASE_ORG_ID || '';
  try {
    if (!organizationId) {
      const orgs = await listOrganizations(token, input.fetchImpl);
      organizationId = orgs[0]?.id || '';
    }
    if (!organizationId) return { ok: false, skipped: true, reason: 'no_organization_available' };

    const project = await createSupabaseProject({
      name: input.appName,
      organizationId,
      region: input.config?.region || process.env.CODEN_SUPABASE_REGION,
      dbPassword: input.config?.dbPassword,
      plan: input.config?.plan || 'free',
      token,
      fetchImpl: input.fetchImpl,
    });

    let migration: ProvisionAppBackendResult['migration'];
    const sqlFile = input.files ? selectMigrationFromFiles(input.files) : null;
    if (sqlFile) {
      const safety = classifyMigrationSafety(sqlFile.content);
      // Wait a bit for DB to be reachable.
      await new Promise(r => setTimeout(r, 5000));
      const applied = await applyGeneratedMigration({
        projectRef: project.ref,
        sql: sqlFile.content,
        token,
        dryRun: false,
        fetchImpl: input.fetchImpl,
      });
      migration = {
        applied: applied.applied,
        statements: safety.statements,
        error: applied.error,
      };
    }

    const storage = await createDefaultStorageBucket({
      ref: project.ref,
      serviceRoleKey: project.serviceRoleKey,
      fetchImpl: input.fetchImpl,
    });

    return { ok: true, project, migration, storage };
  } catch (error) {
    return { ok: false, error: redactManagementToken((error as Error).message || 'provision_failed') };
  }
}

/** Strip service_role from a provisioned project payload before sending to clients. */
export function publicProvisionedProject(p: SupabaseProvisionedProject) {
  return {
    ref: p.ref,
    url: p.url,
    anon_key: p.anonKey,
    region: p.region,
    status: p.status,
    created_at: p.createdAt,
  };
}