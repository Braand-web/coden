import { createClient } from '@supabase/supabase-js';
import {
  getSupabaseProjectRef,
  hasSupabaseBrowserConfig,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from './supabase-config';
import { TEMPORARY_GENERATION_ACCESS_TOKEN } from '../services/temporary-generation-access';

export const CODEN_AUTH_STORAGE_KEY = 'coden.auth.session.v2';

const LEGACY_AUTH_STORAGE_KEYS = [
  `sb-${getSupabaseProjectRef(SUPABASE_URL)}-auth-token`,
  'huggy.auth.session.v2',
];

function migratePersistedAuthSession() {
  if (typeof window === 'undefined') return;

  try {
    if (window.localStorage.getItem(CODEN_AUTH_STORAGE_KEY)) return;

    for (const legacyKey of LEGACY_AUTH_STORAGE_KEYS) {
      if (!legacyKey || legacyKey === CODEN_AUTH_STORAGE_KEY) continue;
      const persistedSession = window.localStorage.getItem(legacyKey);
      if (!persistedSession) continue;
      window.localStorage.setItem(CODEN_AUTH_STORAGE_KEY, persistedSession);
      break;
    }
  } catch {
    // Storage can be blocked by privacy settings. Supabase will report the
    // actual auth state and route guards will handle that case safely.
  }
}

migratePersistedAuthSession();

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: CODEN_AUTH_STORAGE_KEY,
  },
});

type BrowserSession = Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'];
type BrowserUser = NonNullable<Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user']>;

export type VerifiedSession = {
  session: BrowserSession;
  user: BrowserUser;
};

let temporaryGenerationSession: VerifiedSession | null = null;
let temporaryGenerationSessionExpiresAt = 0;
let temporaryGenerationSignedOutUntil = 0;

async function getTemporaryGenerationSession(): Promise<VerifiedSession | null> {
  if (temporaryGenerationSignedOutUntil > Date.now()) return null;
  if (temporaryGenerationSession && temporaryGenerationSessionExpiresAt > Date.now()) return temporaryGenerationSession;

  try {
    const response = await fetch('/api/auth/temporary-generation', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      temporaryGenerationSession = null;
      temporaryGenerationSessionExpiresAt = 0;
      return null;
    }

    const payload = await response.json().catch(() => null);
    const user = payload?.user;
    const expiresAt = Date.parse(String(payload?.expires_at || ''));
    if (!payload?.temporary_access || !user?.id || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      temporaryGenerationSession = null;
      temporaryGenerationSessionExpiresAt = 0;
      return null;
    }

    temporaryGenerationSession = {
      user: user as BrowserUser,
      session: {
        access_token: TEMPORARY_GENERATION_ACCESS_TOKEN,
        token_type: 'bearer',
        user,
      } as BrowserSession,
    };
    temporaryGenerationSessionExpiresAt = expiresAt;
    return temporaryGenerationSession;
  } catch {
    return null;
  }
}

export function safeRedirectTarget(candidate?: string | null): string {
  const fallback = '/dashboard.html';
  const value = String(candidate || '').trim();
  const removeDisabledDemoFlag = (target: string) => {
    try {
      const parsed = new URL(target, 'https://coden.invalid');
      parsed.searchParams.delete('demo');
      parsed.searchParams.delete('demoMode');
      const query = parsed.searchParams.toString();
      return `${parsed.pathname}${query ? `?${query}` : ''}${parsed.hash}`;
    } catch {
      return target;
    }
  };
  if (!value) return fallback;

  const isSafeInternalPath = (target: string) => {
    const normalized = target.trim();
    if (!normalized.startsWith('/') || normalized.startsWith('//') || normalized.includes('\\')) return false;
    if (/^\/https?:\/\//i.test(normalized)) return false;
    return true;
  };

  try {
    const decoded = decodeURIComponent(value);
    if (isSafeInternalPath(decoded)) {
      return removeDisabledDemoFlag(decoded);
    }
  } catch {
    if (isSafeInternalPath(value)) {
      return removeDisabledDemoFlag(value);
    }
  }

  return fallback;
}

export function getRedirectTarget(): string {
  const params = new URLSearchParams(window.location.search);
  const explicitRedirect = params.get('redirect');
  if (explicitRedirect) return safeRedirectTarget(explicitRedirect);

  return safeRedirectTarget(null);
}

export function getAuthRedirectUrl(target = getRedirectTarget()): string {
  const redirect = encodeURIComponent(safeRedirectTarget(target));
  return `${window.location.origin}/auth.html?redirect=${redirect}`;
}

export function getCurrentPrivatePath(): string {
  const current = `${window.location.pathname}${window.location.search}`;
  return safeRedirectTarget(current || '/dashboard.html');
}

export function isConfirmedInvalidSessionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { message?: unknown; code?: unknown; name?: unknown };
  const text = `${record.name || ''} ${record.code || ''} ${record.message || ''}`.toLowerCase();
  return /invalid.*jwt|jwt.*expired|session.*not.*found|refresh.*token.*not.*found|invalid.*refresh|token.*expired|not authenticated/.test(text);
}

async function signOutLocalQuietly() {
  if (!hasSupabaseBrowserConfig()) return;
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Local cleanup should never crash route guards or API retries.
  }
}

async function verifySessionUser(session: BrowserSession): Promise<{ verified: VerifiedSession | null; error: unknown }> {
  if (!session?.access_token) return { verified: null, error: null };
  try {
    const { data, error } = await supabase.auth.getUser(session.access_token);
    if (error || !data?.user) {
      return { verified: null, error: error || new Error('Supabase user missing from session') };
    }
    return { verified: { session, user: data.user }, error: null };
  } catch (error) {
    return { verified: null, error };
  }
}

export async function refreshVerifiedSession(): Promise<VerifiedSession | null> {
  if (!hasSupabaseBrowserConfig()) return getTemporaryGenerationSession();
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data?.session) {
      if (isConfirmedInvalidSessionError(error)) await signOutLocalQuietly();
      return getTemporaryGenerationSession();
    }

    const verified = await verifySessionUser(data.session);
    if (verified.verified) return verified.verified;
    if (isConfirmedInvalidSessionError(verified.error)) await signOutLocalQuietly();
    return getTemporaryGenerationSession();
  } catch (error) {
    if (isConfirmedInvalidSessionError(error)) await signOutLocalQuietly();
    return getTemporaryGenerationSession();
  }
}

const SESSION_RETRY_DELAYS_MS = [0, 120, 320];

async function readPersistedSession() {
  let result: Awaited<ReturnType<typeof supabase.auth.getSession>> | null = null;

  for (const delay of SESSION_RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay));
    result = await supabase.auth.getSession();
    if (result.data?.session || (result.error && isConfirmedInvalidSessionError(result.error))) return result;
  }

  return result || { data: { session: null }, error: null };
}

export async function getVerifiedSession(options: { allowRefresh?: boolean } = {}): Promise<VerifiedSession | null> {
  if (!hasSupabaseBrowserConfig()) return getTemporaryGenerationSession();
  const allowRefresh = options.allowRefresh !== false;
  try {
    const { data, error } = await readPersistedSession();
    const session = data?.session;
    if (error || !session) return getTemporaryGenerationSession();

    const verified = await verifySessionUser(session);
    if (verified.verified) return verified.verified;

    if (allowRefresh) {
      const refreshed = await refreshVerifiedSession();
      if (refreshed) return refreshed;
    }

    if (isConfirmedInvalidSessionError(verified.error)) await signOutLocalQuietly();
    return getTemporaryGenerationSession();
  } catch {
    return getTemporaryGenerationSession();
  }
}

export async function signOutCurrentDevice(): Promise<void> {
  await signOutLocalQuietly();
  temporaryGenerationSession = null;
  temporaryGenerationSessionExpiresAt = 0;
  temporaryGenerationSignedOutUntil = Date.now() + 2_000;
}
