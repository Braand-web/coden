/**
 * Remembering which Supabase project an application belongs to.
 *
 * The pieces were all here and none of them touched. `supabase-auto-provision`
 * creates a dedicated Supabase project per app — database, auth, storage —
 * and `server.ts` calls it once at project creation. `coden_cloud_projects`
 * has had `supabase_project_ref`, `supabase_url` and `anon_key_encrypted`
 * columns since the Coden Cloud foundation migration. `launchProjectPreview`
 * takes an `env` map and hands it to the sandbox. And the `react-supabase`
 * starter builds its client from `VITE_SUPABASE_URL` and
 * `VITE_SUPABASE_ANON_KEY`.
 *
 * Between them: nothing. The provisioning result was returned in the creation
 * response and then dropped on the floor, the row stayed at
 * `status: 'planned'` with empty credentials, the pipeline launched the
 * sandbox with no env at all, and every generated app that asked for auth or a
 * database came up printing "Supabase is not configured yet" — which is the
 * scaffold being honest about a backend nobody ever connected.
 *
 * This is the wire between them.
 *
 * On secrets: the anon key is public by design — it ships in every browser
 * bundle and is meaningless without row-level security — so it is stored and
 * handed to the sandbox. The service role key is not. It is a real credential,
 * nothing in this repository encrypts anything (the `_encrypted` column suffix
 * is aspirational, there is no cipher behind it), and a generated application
 * must never receive one: writing it into a column that claims an encryption
 * it does not perform would be worse than not storing it at all.
 */

/** The slice of a Supabase client this needs, so callers pass theirs unchanged. */
type BackendClient = {
  from(table: string): any;
};

/** What a generated application needs in its environment to reach its backend. */
export type ProjectBackendEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

/**
 * Record the Supabase project this application was given.
 *
 * Updates the `coden_cloud_projects` row that `upsertProjectBackendRequirements`
 * already creates, rather than inserting a second one: the row exists, it is
 * keyed on `project_id`, and it is sitting at `status: 'planned'` waiting for
 * exactly this.
 *
 * Returns whether it was written. Never throws: an application whose backend
 * was provisioned has already succeeded at the expensive part, and losing the
 * bookkeeping is not a reason to fail the creation that produced it.
 */
export async function saveProvisionedBackend(input: {
  client: BackendClient | null;
  projectId: string;
  organizationId?: string | null;
  provisioned: {
    ref: string;
    url: string;
    anonKey: string;
    region?: string;
    status?: string;
  };
}): Promise<boolean> {
  const { client, projectId, provisioned } = input;
  if (!client || !projectId) return false;
  if (!provisioned?.ref || !provisioned.url || !provisioned.anonKey) return false;

  try {
    const now = new Date().toISOString();
    const { error } = await client.from('coden_cloud_projects').upsert([{
      organization_id: input.organizationId || null,
      project_id: projectId,
      provider: 'supabase',
      mode: 'dedicated',
      status: 'active',
      region: provisioned.region || 'auto',
      supabase_project_ref: provisioned.ref,
      supabase_url: provisioned.url,
      anon_key_encrypted: provisioned.anonKey,
      // Deliberately absent: service_role_key_encrypted. See the module note.
      public_runtime_config: {
        backend_status: 'active',
        backend_mode: 'dedicated',
        managed_by: 'supabase_auto_provision',
        supabase_project_ref: provisioned.ref,
        supabase_url: provisioned.url,
        provisioned_at: now,
      },
      updated_at: now,
    }], { onConflict: 'project_id' });

    if (error) {
      console.warn('[coden:project_backend_save_failed]', { message: error.message });
      return false;
    }
    return true;
  } catch (error: any) {
    console.warn('[coden:project_backend_save_failed]', { message: error?.message });
    return false;
  }
}

/**
 * The environment a run must give the sandbox for this project's app to reach
 * its backend.
 *
 * Returns `{}` when there is nothing to give — no backend was provisioned, the
 * table is absent, the query failed. A missing backend must never stop a
 * generation: the scaffold already renders an honest "not configured yet"
 * state, which is a working application with one feature unavailable rather
 * than a failed run.
 */
export async function loadProjectBackendEnv(input: {
  client: BackendClient | null;
  projectId: string;
}): Promise<ProjectBackendEnv> {
  if (!input.client || !input.projectId) return {};
  try {
    const { data } = await input.client
      .from('coden_cloud_projects')
      .select('supabase_url, anon_key_encrypted, status')
      .eq('project_id', input.projectId)
      .maybeSingle();

    const url = String(data?.supabase_url || '').trim();
    const anonKey = String(data?.anon_key_encrypted || '').trim();
    // A half-provisioned backend is worse than none: a client built from a URL
    // with no key fails at the first call, deep inside the app, instead of at
    // the scaffold's own configuration check.
    if (!url || !anonKey) return {};

    return { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey };
  } catch (error: any) {
    console.warn('[coden:project_backend_load_failed]', { message: error?.message });
    return {};
  }
}

/**
 * What the coder is told about the backend it is building against.
 *
 * Without this the agent sees a Supabase client in the scaffold, has no way to
 * know whether it points anywhere, and hedges — mock arrays, `TODO: connect
 * Supabase`, a localStorage stand-in next to a real client it never calls.
 * Naming the live project is what turns that into real queries.
 */
export function describeProjectBackend(env: ProjectBackendEnv): string | undefined {
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) return undefined;
  return [
    'LIVE BACKEND.',
    `This project has its own Supabase project, already running at ${env.VITE_SUPABASE_URL}.`,
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are already set in the environment — import the client from src/lib/supabase.ts and use it. Never hardcode the URL or the key, and never read them from anywhere else.',
    'So persist real data: write the tables the app needs and query them. Do not build a localStorage stand-in, mock arrays, or a "connect your backend" placeholder alongside a client that works.',
    'Auth is available on the same project. Storage too, through the default bucket.',
    'Every table needs row-level security enabled with policies scoped to auth.uid() before it holds anything real — the anon key is public and reaches the browser, so a table without policies is a table anyone can read.',
    'The service role key is not available here and must never appear in application code: it bypasses every policy, and this code runs in a browser.',
  ].join('\n');
}
