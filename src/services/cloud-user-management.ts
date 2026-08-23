/**
 * Cloud User Management — pure, server-side helpers for managing the END-USERS
 * of a generated app (the app's own Supabase Auth).
 *
 * THIS IS THE MOST DANGEROUS SUBSYSTEM: it backs operations that use a project's
 * service_role. This module holds ONLY pure logic — no secrets, no I/O, no
 * service_role. Its single most important job is safeUserFields(): NEVER spread a
 * raw Supabase user object into an API response (that could leak
 * encrypted_password, tokens, identities, factors…). Only explicit, whitelisted,
 * non-sensitive fields are ever exposed.
 */

/** App-level roles a project owner may assign. No privilege escalation beyond
 *  this allow-list (e.g. never 'service_role', 'supabase_admin', 'postgres'). */
export const ALLOWED_APP_USER_ROLES = ['user', 'member', 'editor', 'admin'] as const;
export type AppUserRole = (typeof ALLOWED_APP_USER_ROLES)[number];

export const MAX_USERS_PAGE = 100;
export const DEFAULT_USERS_PAGE = 50;

// Conservative email check: one @, no spaces/control chars, bounded length.
const EMAIL_RE = /^[^\s@]{1,128}@[^\s@.]+(\.[^\s@.]+)+$/;

export function isValidEmail(email: unknown): boolean {
  const value = String(email == null ? '' : email).trim();
  return value.length <= 254 && EMAIL_RE.test(value);
}

/** Return a valid app role, or null if not in the allow-list (no escalation). */
export function sanitizeAppRole(role: unknown): AppUserRole | null {
  const value = String(role == null ? '' : role).trim().toLowerCase();
  return (ALLOWED_APP_USER_ROLES as readonly string[]).includes(value) ? (value as AppUserRole) : null;
}

export function sanitizeUsersPerPage(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_USERS_PAGE;
  return Math.min(MAX_USERS_PAGE, n);
}

export function sanitizeUsersPage(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 1) return 1;
  return Math.min(100000, n);
}

/** A user is banned when banned_until is a date in the future. */
function computeBanned(bannedUntil: unknown): boolean {
  if (!bannedUntil) return false;
  const time = Date.parse(String(bannedUntil));
  return Number.isFinite(time) && time > Date.now();
}

export interface SafeEndUser {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  confirmed: boolean;
  banned: boolean;
  role: AppUserRole | null;
}

/**
 * Map a raw Supabase admin user object to ONLY safe, whitelisted fields.
 * Never spreads the source — anything not listed here (password hashes, tokens,
 * identities, recovery/confirmation tokens, factors, metadata blobs) is dropped.
 */
export function safeUserFields(rawUser: any): SafeEndUser {
  const user = rawUser || {};
  const appMeta = (user.app_metadata && typeof user.app_metadata === 'object') ? user.app_metadata : {};
  const userMeta = (user.user_metadata && typeof user.user_metadata === 'object') ? user.user_metadata : {};
  const role = sanitizeAppRole(appMeta.role) || sanitizeAppRole(userMeta.role);
  return {
    id: String(user.id || ''),
    email: user.email ? String(user.email) : null,
    created_at: user.created_at ? String(user.created_at) : null,
    last_sign_in_at: user.last_sign_in_at ? String(user.last_sign_in_at) : null,
    confirmed: Boolean(user.email_confirmed_at || user.confirmed_at),
    banned: computeBanned(user.banned_until),
    role: role || null,
  };
}

/** Whitelist of keys that may ever appear in a serialized end-user. Used by the
 *  tests to prove no sensitive field leaks through safeUserFields(). */
export const SAFE_USER_KEYS: ReadonlyArray<keyof SafeEndUser> = [
  'id', 'email', 'created_at', 'last_sign_in_at', 'confirmed', 'banned', 'role',
];

export type MutationGuard = { ok: true } | { ok: false; code: string; error: string };

/** Every mutating action requires an explicit confirmation flag. */
export function requireConfirmation(body: any): MutationGuard {
  if (body && (body.confirm === true || body.confirm === 'true')) return { ok: true };
  return { ok: false, code: 'confirmation_required', error: 'Action non confirmée.' };
}

/**
 * Deletion is irreversible → double confirmation: the explicit confirm flag AND
 * the caller must echo back the exact email of the user being deleted.
 */
export function requireDeleteConfirmation(body: any, targetEmail: string | null): MutationGuard {
  const base = requireConfirmation(body);
  if (!base.ok) return base;
  const echoed = String((body && (body.confirm_email ?? body.confirmEmail)) || '').trim().toLowerCase();
  const expected = String(targetEmail || '').trim().toLowerCase();
  if (!expected || echoed !== expected) {
    return { ok: false, code: 'double_confirmation_required', error: 'Double confirmation requise : ressaisissez l\'email exact de l\'utilisateur à supprimer.' };
  }
  return { ok: true };
}
