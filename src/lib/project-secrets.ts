import { createHash } from 'node:crypto';
import { decryptSecret, encryptSecret } from './secret-box.ts';

/**
 * A project's secrets: sealed at rest, opened only on the server.
 *
 * They used to be stored as `sha256:<salt>:<digest>` — a hash, not a cipher —
 * so a value, once saved, could never be read back by anything: not by the
 * application's functions it was meant for, not by anyone. Now AES-256-GCM
 * (`secret-box.ts`), sealed with `CODEN_SECRETS_KEY`.
 *
 * Without that variable, the key is derived from `SUPABASE_SERVICE_ROLE_KEY`
 * under its own label. Both stay on the server; anyone holding the service
 * role key can already read this table, so the derivation weakens nothing —
 * but rotating that key would make the stored values unreadable, which is why
 * a dedicated `CODEN_SECRETS_KEY` is preferred and a warning says so.
 *
 * Nothing in this module, and nothing it returns to a route, ever carries a
 * plaintext value to a browser.
 */

export const LEGACY_HASH_PREFIX = 'sha256:';
const VARIABLE_RE = /^[A-Z][A-Z0-9_]{1,79}$/;

let warned = false;

export function projectSecretsKey(env: Record<string, string | undefined> = process.env): string {
  const dedicated = String(env.CODEN_SECRETS_KEY || '').trim();
  if (dedicated) return dedicated;
  const serviceRole = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceRole) return '';
  if (!warned && env === process.env) {
    warned = true;
    console.warn('[coden:project_secrets_derived_key]', { hint: 'Set CODEN_SECRETS_KEY so project secrets survive a rotation of the service role key.' });
  }
  return createHash('sha256').update(`coden-project-secrets:v1:${serviceRole}`, 'utf8').digest('base64');
}

export function isValidSecretVariable(name: unknown): name is string {
  return typeof name === 'string' && VARIABLE_RE.test(name);
}

export function normalizeSecretService(value: unknown): string {
  const clean = String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60);
  return clean || 'Custom';
}

export function maskSecretValue(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••••${value.slice(-4)}`;
}

export function sealProjectSecret(value: string, key = projectSecretsKey()): string {
  return encryptSecret(value, key);
}

/** The plaintext, or '' for a legacy hash, a missing key or a value that does not open. */
export function openProjectSecret(sealed: string | null | undefined, key = projectSecretsKey()): string {
  if (!sealed || sealed.startsWith(LEGACY_HASH_PREFIX)) return '';
  return decryptSecret(sealed, key);
}

export type StoredSecretRow = {
  id: string;
  service?: string | null;
  variable: string;
  encrypted_value?: string | null;
  masked_value?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/**
 * What the console may see of a secret: its name, its mask, and whether the
 * server can still read it. A value saved before encryption existed was only
 * ever hashed and has to be entered again.
 */
export function publicSecretRow(row: StoredSecretRow) {
  const sealed = String(row.encrypted_value || '');
  const needsReentry = Boolean(row.status !== 'skipped' && (!sealed || sealed.startsWith(LEGACY_HASH_PREFIX)));
  return {
    id: row.id,
    service: row.service || 'Custom',
    variable: row.variable,
    masked_value: row.masked_value || '••••••••',
    status: needsReentry ? 'needs_reentry' : (row.status || 'configured'),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

/**
 * The environment an application's server code receives.
 *
 * `VITE_*` names are left out on purpose: Vite inlines them into the browser
 * bundle, so a secret under such a name would be published with the site.
 */
export function serverSecretEnv(rows: StoredSecretRow[], key = projectSecretsKey()): Record<string, string> {
  const env: Record<string, string> = {};
  for (const row of rows) {
    if (!isValidSecretVariable(row.variable) || row.variable.startsWith('VITE_')) continue;
    const value = openProjectSecret(row.encrypted_value, key);
    if (value) env[row.variable] = value;
  }
  return env;
}

/** For the agents: which secrets exist, never their values. */
export function describeServerSecrets(names: string[]): string | undefined {
  if (!names.length) return undefined;
  return [
    'SERVER SECRETS.',
    `These environment variables are set on the application's server: ${names.join(', ')}.`,
    'Read them with process.env inside server code only (API routes, functions, webhooks). Never import them into browser code, never prefix them with VITE_, and never print or log their values.',
  ].join('\n');
}
