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

/*
 * Names the runtime owns. A secret under one of these would change how the
 * dev server or Node itself starts (NODE_OPTIONS can load code, LD_PRELOAD a
 * library, PATH which binaries run), or shadow what Coden sets for the app.
 */
const RESERVED_NAMES = new Set(['PATH', 'HOME', 'USER', 'SHELL', 'PWD', 'TMPDIR', 'PORT', 'HOST', 'HOSTNAME', 'NODE_ENV', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'BROWSER', 'CI']);
const RESERVED_PREFIXES = ['LD_', 'DYLD_', 'NPM_CONFIG_', 'CODEN_', 'E2B_', 'VITE_', 'RAILWAY_'];

export function isReservedSecretVariable(name: string): boolean {
  return RESERVED_NAMES.has(name) || RESERVED_PREFIXES.some(prefix => name.startsWith(prefix));
}

export function isValidSecretVariable(name: unknown): name is string {
  return typeof name === 'string' && VARIABLE_RE.test(name) && !isReservedSecretVariable(name);
}

export function normalizeSecretService(value: unknown): string {
  const clean = String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60);
  return clean || 'Custom';
}

/**
 * What may be shown of a value: its last four characters, and only when it is
 * long enough that four characters give nothing useful away. A prefix is never
 * shown — it is the part that names the provider and the key's kind.
 */
export function maskSecretValue(value: string): string {
  if (!value) return '';
  if (value.length < 20) return '••••••••';
  return `••••••••${value.slice(-4)}`;
}

/** The same rule applied to a mask stored before it existed (`abcd••••••wxyz`). */
export function normalizeStoredMask(mask: string | null | undefined): string {
  const text = String(mask || '');
  if (!text || text === 'not configured') return '••••••••';
  const tail = /•+([^•]{1,4})$/.exec(text)?.[1];
  return tail && text.length >= 12 ? `••••••••${tail}` : '••••••••';
}

export function sealProjectSecret(value: string, key = projectSecretsKey()): string {
  return encryptSecret(value, key);
}

/**
 * The key a value may have been sealed with before `CODEN_SECRETS_KEY` was
 * set: the one derived from the service role key. Kept as a fallback for
 * opening only, so setting the dedicated key later loses nothing.
 */
function previousProjectSecretsKey(env: Record<string, string | undefined> = process.env): string {
  if (!String(env.CODEN_SECRETS_KEY || '').trim()) return '';
  return projectSecretsKey({ SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY });
}

/** The plaintext, or '' for a legacy hash, a missing key or a value that does not open. */
export function openProjectSecret(sealed: string | null | undefined, key = projectSecretsKey(), fallbackKey = previousProjectSecretsKey()): string {
  if (!sealed || sealed.startsWith(LEGACY_HASH_PREFIX)) return '';
  return decryptSecret(sealed, key, { quiet: Boolean(fallbackKey) }) || (fallbackKey ? decryptSecret(sealed, fallbackKey) : '');
}

/**
 * Replaces every secret value in a text with its name.
 *
 * The application's server receives its secrets in its environment, and the
 * agents drive that environment through tools: a `printenv`, a log line or a
 * page that echoes a variable would otherwise carry the value into the
 * model's context, and from there to the provider and the conversation.
 * Every tool result passes through this before the model sees it.
 */
export function createSecretRedactor(secrets: Record<string, string>): ((text: string) => string) | undefined {
  const pairs: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(secrets)) {
    if (!value || value.length < 6) continue;
    pairs.push([value, `[secret:${name}]`]);
    const escaped = JSON.stringify(value).slice(1, -1);
    if (escaped !== value) pairs.push([escaped, `[secret:${name}]`]);
  }
  if (!pairs.length) return undefined;
  pairs.sort((a, b) => b[0].length - a[0].length);
  return (text: string) => {
    let output = String(text ?? '');
    for (const [value, label] of pairs) if (output.includes(value)) output = output.split(value).join(label);
    return output;
  };
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
    masked_value: normalizeStoredMask(row.masked_value),
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
    if (!isValidSecretVariable(row.variable)) continue;
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
