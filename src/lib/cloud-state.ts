/**
 * What the Cloud console says about a project's backend, and what it offers
 * to do about it.
 *
 * "Non détecté" used to be the answer for every project in production: 73 of
 * 92 had never been analysed (detection read the first prompt's keywords and
 * nothing else), and the other 19 sat at `planned`, a status the console did
 * not know and filed under the same label. It explained nothing and offered
 * nothing. Each state here says what is true, why, and the one action that
 * moves it forward.
 *
 * Pure and dependency-free: the server computes it for the API, the console
 * renders it, the tests read it.
 */

export type CloudState = 'connected' | 'provisioning' | 'failed' | 'required' | 'not_needed';
export type CloudTone = 'ok' | 'warn' | 'error' | 'neutral';
export type CloudAction = 'provision' | 'retry' | null;

export type CloudStateView = {
  state: CloudState;
  label: string;
  tone: CloudTone;
  explanation: string;
  action: CloudAction;
  action_label: string | null;
};

export type BackendNeeds = {
  needs_database: boolean;
  needs_auth: boolean;
  needs_storage: boolean;
};

type FileLike = { path: string; content?: string | null };

/**
 * What the project's own files say it needs.
 *
 * The prompt is one sentence written before any code existed; the files are
 * what was actually built. A schema, a Supabase client, a sign-in call: each
 * is a backend the app will reach for, whatever the first prompt said.
 */
export function detectBackendNeedsFromFiles(files: FileLike[]): BackendNeeds {
  let needsDatabase = false;
  let needsAuth = false;
  let needsStorage = false;
  for (const file of files) {
    const path = String(file.path || '');
    const content = String(file.content || '');
    if (/(^|\/)supabase\/(schema|migrations?)\b|\.sql$/i.test(path) && /create\s+table/i.test(content)) needsDatabase = true;
    if (/(^|\/)package\.json$/.test(path) && /"@supabase\/supabase-js"/.test(content)) needsDatabase = true;
    if (!/\.(tsx?|jsx?|mjs|cjs|vue|svelte)$/i.test(path)) continue;
    if (/from\s+['"]@supabase\/supabase-js['"]|createClient\s*\(\s*import\.meta\.env\.VITE_SUPABASE/.test(content)) needsDatabase = true;
    if (/\.from\(\s*['"][a-z_][a-z0-9_]*['"]\s*\)\s*\.(select|insert|update|upsert|delete)\(/i.test(content)) needsDatabase = true;
    if (/\bauth\.(signInWith\w+|signUp|signOut|getSession|getUser|onAuthStateChange)\b/.test(content)) needsAuth = true;
    if (/\bstorage\s*\.\s*from\(/.test(content)) needsStorage = true;
  }
  return { needs_database: needsDatabase || needsAuth || needsStorage, needs_auth: needsAuth, needs_storage: needsStorage };
}

export function hasBackendNeed(needs: Partial<BackendNeeds> | null | undefined): boolean {
  return Boolean(needs && (needs.needs_database || needs.needs_auth || needs.needs_storage));
}

const PROVISION_REASONS: Record<string, string> = {
  no_management_token: 'La création automatique de backends n’est pas configurée sur cette instance de Coden.',
  invalid_token_format: 'Le jeton de gestion configuré n’est pas un jeton d’accès Supabase valide (il doit commencer par « sbp_ »).',
  invalid_token: 'Le jeton de gestion Supabase a été refusé : il est expiré ou révoqué.',
  forbidden: 'Le jeton de gestion n’a pas le droit de créer un projet dans l’organisation Supabase.',
  no_organization_available: 'Aucune organisation Supabase n’est accessible avec le jeton configuré.',
  quota_reached: 'Le quota de projets de l’organisation Supabase est atteint.',
  rate_limited: 'Supabase limite temporairement les créations de projets. Réessayez dans quelques minutes.',
  network_error: 'Supabase n’a pas répondu à temps. Réessayez dans quelques instants.',
  provider_error: 'Supabase a refusé la création du backend.',
};

/** A sentence for a stored reason code; never the provider's raw message. */
export function provisionReasonText(reason: string | null | undefined): string {
  return PROVISION_REASONS[String(reason || '')] || PROVISION_REASONS.provider_error;
}

/** Whether the person looking can fix it by retrying, or only an administrator can. */
export function provisionReasonIsPlatformSide(reason: string | null | undefined): boolean {
  return ['no_management_token', 'invalid_token_format', 'invalid_token', 'forbidden', 'no_organization_available', 'quota_reached'].includes(String(reason || ''));
}

export function resolveCloudState(input: {
  status?: string | null;
  hasSupabaseUrl?: boolean;
  needs?: Partial<BackendNeeds> | null;
  lastError?: string | null;
  provisioningAvailable?: boolean;
}): CloudStateView {
  const status = String(input.status || '').toLowerCase();
  const available = input.provisioningAvailable !== false;
  if (input.hasSupabaseUrl || /^(ready|active|provisioned|connected|enabled)$/.test(status)) {
    return { state: 'connected', label: 'Connecté', tone: 'ok', explanation: 'Le backend de cette application est actif : base de données, authentification et stockage sont disponibles.', action: null, action_label: null };
  }
  if (/^(provisioning|migrating|pending|queued|in_progress)$/.test(status)) {
    return { state: 'provisioning', label: 'Activation en cours', tone: 'warn', explanation: 'Coden crée le backend de cette application. Cela prend en général une à deux minutes.', action: null, action_label: null };
  }
  if (/fail|error|unavailable/.test(status)) {
    const platform = provisionReasonIsPlatformSide(input.lastError);
    return {
      state: 'failed',
      label: 'Échec de l’activation',
      tone: 'error',
      explanation: `${provisionReasonText(input.lastError)}${platform ? ' Un administrateur Coden doit corriger la configuration ; vous pourrez ensuite réessayer.' : ''}`,
      action: 'retry',
      action_label: 'Réessayer l’activation',
    };
  }
  if (hasBackendNeed(input.needs)) {
    const parts = [input.needs?.needs_database ? 'une base de données' : '', input.needs?.needs_auth ? 'des comptes utilisateurs' : '', input.needs?.needs_storage ? 'du stockage de fichiers' : ''].filter(Boolean);
    return {
      state: 'required',
      label: 'À activer',
      tone: 'warn',
      explanation: available
        ? `Cette application utilise ${parts.join(', ') || 'un backend'}, mais son backend n’est pas encore créé. Activez Coden Cloud pour que ces fonctions marchent réellement.`
        : `Cette application utilise ${parts.join(', ') || 'un backend'}. ${provisionReasonText('no_management_token')}`,
      action: available ? 'provision' : null,
      action_label: available ? 'Activer Coden Cloud' : null,
    };
  }
  return {
    state: 'not_needed',
    label: 'Aucun backend requis',
    tone: 'neutral',
    explanation: 'Cette application fonctionne sans base de données. Coden Cloud s’active dès que vous demandez des données, des comptes ou des fichiers — ou maintenant, si vous le souhaitez.',
    action: available ? 'provision' : null,
    action_label: available ? 'Activer quand même' : null,
  };
}
