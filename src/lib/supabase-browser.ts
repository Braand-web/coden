import { createClient } from '@supabase/supabase-js';
import { hasSupabaseBrowserConfig, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase-config';

export const CODEN_AUTH_STORAGE_KEY = 'coden.auth.session.v2';

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

  const requestedPlan = params.get('plan');
  const requestedBilling = params.get('billing') === 'annual' || params.get('billing') === 'yearly' ? 'annual' : 'monthly';
  if (requestedPlan === 'pro' || requestedPlan === 'scale') {
    return `/checkout.html?plan=${requestedPlan}&billing=${requestedBilling}`;
  }

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
  const record = error as { status?: unknown; message?: unknown; code?: unknown; name?: unknown };
  const status = Number(record.status || 0);
  const text = `${record.name || ''} ${record.code || ''} ${record.message || ''}`.toLowerCase();
  return (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    /invalid.*jwt|jwt.*expired|session.*not.*found|refresh.*token.*not.*found|invalid.*refresh|token.*expired|not authenticated/.test(text)
  );
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
  if (!hasSupabaseBrowserConfig()) return null;
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data?.session) {
      if (isConfirmedInvalidSessionError(error)) await signOutLocalQuietly();
      return null;
    }

    const verified = await verifySessionUser(data.session);
    if (verified.verified) return verified.verified;
    if (isConfirmedInvalidSessionError(verified.error)) await signOutLocalQuietly();
    return null;
  } catch (error) {
    if (isConfirmedInvalidSessionError(error)) await signOutLocalQuietly();
    return null;
  }
}

export async function getVerifiedSession(options: { allowRefresh?: boolean } = {}): Promise<VerifiedSession | null> {
  if (!hasSupabaseBrowserConfig()) return null;
  const allowRefresh = options.allowRefresh !== false;
  try {
    const { data, error } = await supabase.auth.getSession();
    const session = data?.session;
    if (error || !session) return null;

    const verified = await verifySessionUser(session);
    if (verified.verified) return verified.verified;

    if (allowRefresh) {
      const refreshed = await refreshVerifiedSession();
      if (refreshed) return refreshed;
    }

    if (isConfirmedInvalidSessionError(verified.error)) await signOutLocalQuietly();
    return null;
  } catch {
    return null;
  }
}

export async function signOutCurrentDevice(): Promise<void> {
  await signOutLocalQuietly();
}
