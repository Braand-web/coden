/**
 * Whether this browser holds a Coden session, without loading Supabase.
 *
 * The public pages always offered "Connexion" and "Créer un compte", even to
 * someone signed in: nothing on them looked at the session, and loading the
 * Supabase client on the landing to find out would cost every visitor its
 * weight. The session Supabase persists is already in localStorage; a stored
 * refresh token is enough to know the account can be reopened. The auth page
 * still verifies it for real — this only decides which links to show.
 */

const SESSION_KEYS = ['coden.auth.session.v2', 'huggy.auth.session.v2'];

function readStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

function isSession(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const value = JSON.parse(raw);
    const session = value?.currentSession || value?.session || value;
    return Boolean(session?.refresh_token && (session?.user?.id || session?.access_token));
  } catch {
    return false;
  }
}

export function hasStoredSession(storage: Pick<Storage, 'getItem' | 'length' | 'key'> | null = readStorage()): boolean {
  if (!storage) return false;
  try {
    if (SESSION_KEYS.some(key => isSession(storage.getItem(key)))) return true;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index) || '';
      if (/^sb-[a-z0-9]+-auth-token$/i.test(key) && isSession(storage.getItem(key))) return true;
    }
  } catch {
    // Blocked storage: treat as signed out; the auth page decides for real.
  }
  return false;
}

/** Where a signed-in person should go instead of an account-creation link. */
export function signedInDestination(href: string): string {
  try {
    const url = new URL(href, 'https://coden.local');
    if (url.pathname !== '/auth.html') return href;
    const redirect = url.searchParams.get('redirect') || '';
    return /^\/(?!\/)[^\\]*$/.test(redirect) && !redirect.startsWith('/auth.html') ? redirect : '/dashboard.html';
  } catch {
    return '/dashboard.html';
  }
}

const CREATE_SPACE_LABEL = /^Créer mon espace(?: Coden)?$/i;

/**
 * Sign-up and sign-in links on a page, pointed at the account instead.
 * Password resets are left alone: they are not about having a session.
 */
export function applySignedInLinks(root: ParentNode = document): number {
  let changed = 0;
  root.querySelectorAll<HTMLAnchorElement>('a[href^="/auth.html"]').forEach(link => {
    const href = link.getAttribute('href') || '';
    if (/mode=reset-password/.test(href)) return;
    link.setAttribute('href', signedInDestination(href));
    if (CREATE_SPACE_LABEL.test((link.textContent || '').trim())) link.textContent = 'Ouvrir mon espace';
    changed += 1;
  });
  return changed;
}

/** The stored access token, for a same-site API call that only upgrades the page. */
export function storedAccessToken(storage: Pick<Storage, 'getItem' | 'length' | 'key'> | null = readStorage()): string | null {
  if (!storage) return null;
  const tokenOf = (raw: string | null) => {
    try {
      const value = JSON.parse(raw || 'null');
      const session = value?.currentSession || value?.session || value;
      return typeof session?.access_token === 'string' ? session.access_token : null;
    } catch { return null; }
  };
  try {
    for (const key of SESSION_KEYS) { const token = tokenOf(storage.getItem(key)); if (token) return token; }
  } catch { /* blocked storage */ }
  return null;
}
