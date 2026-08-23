import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const serverSource = readFileSync('server.ts', 'utf8');
const browserAuthSource = readFileSync('src/lib/supabase-browser.ts', 'utf8');
const browserConfigSource = readFileSync('src/lib/supabase-config.ts', 'utf8');
const authGuardSource = readFileSync('src/auth-guard.ts', 'utf8');
const authPageSource = readFileSync('auth.html', 'utf8');

assert(
  serverSource.includes('function getRequiredAuth'),
  'server auth must expose a single getRequiredAuth helper',
);

assert(
  serverSource.includes('SERVER_AUTH_STATE_INVARIANT'),
  'server auth invariant must be logged internally',
);

assert(
  !/diagnostic_code:\s*['"]AUTH_USER_UNDEFINED_BUG['"]/.test(serverSource),
  'AUTH_USER_UNDEFINED_BUG must never be returned as a public diagnostic',
);

assert(
  !/AUTH_USER_UNDEFINED_BUG:\s*['"]check_server_auth_flow['"]/.test(serverSource),
  'AUTH_USER_UNDEFINED_BUG must not have a public suggested action',
);

assert(
  !serverSource.includes('AUTH_USER_UNDEFINED_BUG'),
  'AUTH_USER_UNDEFINED_BUG must be removed from server auth flow entirely',
);

assert(
  !/function getUserOrgId\(req: any\): string \{\s*return req\.user\?\.id \|\| DEFAULT_ORG_ID;\s*\}/.test(serverSource),
  'authenticated user lookup must not silently fall back to DEFAULT_ORG_ID',
);

assert(
  !/catch\s*\{\s*await supabase\.auth\.signOut\(\);\s*return null;\s*\}/.test(browserAuthSource),
  'browser auth must not sign out on generic transient errors',
);

assert(
  browserAuthSource.includes('isConfirmedInvalidSessionError'),
  'browser auth must sign out only on confirmed invalid session errors',
);

assert(
  browserAuthSource.includes('/^\\/https?:\\/\\//i.test(normalized)'),
  'browser auth redirects must reject malformed absolute URL paths like /https://www.coden.fun/admin.html',
);

assert(
  browserAuthSource.includes("searchParams.delete('demo')") &&
    browserAuthSource.includes("searchParams.delete('demoMode')"),
  'disabled demo flags must be stripped from private redirects',
);

assert(
  serverSource.includes('normalizeMalformedAbsolutePath') &&
    serverSource.includes("res.redirect(302, normalizedPath)"),
  'server must repair malformed absolute Coden paths before static routing',
);

assert(
  browserAuthSource.includes("scope: 'local'"),
  'browser auth must sign out current device only',
);

assert(
  browserAuthSource.includes("flowType: 'pkce'"),
  'browser auth must use the PKCE OAuth flow',
);

assert(
  browserAuthSource.includes("CODEN_AUTH_STORAGE_KEY = 'coden.auth.session.v2'"),
  'browser auth must use the v2 auth storage key',
);

assert(
  browserConfigSource.includes("UNCONFIGURED_SUPABASE_URL = 'https://coden-unconfigured.invalid'") &&
    browserConfigSource.includes('usingDevFallback: false') &&
    !browserConfigSource.includes('allowDevFallback') &&
    !browserConfigSource.includes('configuredUrl || \'https://'),
  'browser Supabase config must fail closed without any hard-coded project fallback',
);

assert(
  browserConfigSource.includes('SUPABASE_BROWSER_CONFIG_STATUS') &&
    browserConfigSource.includes('getSupabaseProjectRef'),
  'browser Supabase config must expose a project-ref diagnostic',
);

assert(
  authGuardSource.includes('getVerifiedSession({ allowRefresh: true })'),
  'private route guard must refresh once before redirecting',
);

assert(
  authPageSource.includes('data-provider="google"') &&
    (authPageSource.includes('Continuer avec Google') || authPageSource.includes('Continue with Google')),
  'auth page must include the Google sign-in control',
);

assert(
  authPageSource.includes('id="name-field"') && !authPageSource.includes('id="name-group"'),
  'auth page must expose #name-field for src/auth.ts and must not keep stale #name-group',
);

assert(
  authPageSource.includes('id="auth-status"') &&
    authPageSource.includes('role="status"') &&
    authPageSource.includes('aria-live="polite"'),
  'auth page must expose an accessible #auth-status region for src/auth.ts',
);

assert(!authPageSource.includes('auth-showcase'), 'auth page must not keep the removed decorative showcase');
assert(!authPageSource.includes('auth-progress'), 'auth page must not keep the removed decorative progress indicator');
assert(authPageSource.includes('id="forgot-password-link"'), 'auth page must expose a password recovery action');
assert(authPageSource.includes('id="toggle-password"'), 'auth page must expose an accessible password visibility control');
assert(authPageSource.includes('id="password-confirm-field"'), 'auth page must expose the reset password confirmation field');
assert(authPageSource.includes('data-coden-logo'), 'auth page must expose the canonical Coden logo marker');
assert(authPageSource.includes('id="theme-btn"'), 'auth page must expose the shared theme control');

assert(
  authPageSource.includes('type="module" src="/src/auth.ts"'),
  'auth page must load src/auth.ts as the single auth controller',
);

const inlineScripts = Array.from(
  authPageSource.matchAll(/<script(?![^>]*\btype=["']module["'])(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
).map((match) => match[1] || '');
const duplicateInlineAuthScripts = inlineScripts.filter((script) =>
  /signInWithPassword|signUp\(|signInWithOAuth|getVerifiedSession|auth-form|input-email|input-password|tab-signup|name-group/.test(script),
);

assert(
  duplicateInlineAuthScripts.length === 0,
  'auth page must not contain inline login/signup/OAuth logic that duplicates src/auth.ts',
);

assert(
  serverSource.includes('function getOptionalAuthState') &&
    !/req\.auth\?\.userId\s*\|\|\s*null/.test(serverSource),
  'optional auth reads must go through getOptionalAuthState instead of route-local req.auth reads',
);

assert(
  serverSource.includes('project_refs_match: supabaseDiagnostics.project_refs_match'),
  '/api/health must expose project_refs_match at top level',
);

assert(
  serverSource.includes("diagnostic_code: 'SUPABASE_AUTH_CLIENT_UNDEFINED'"),
  'server must classify generated-app Supabase auth client crashes explicitly',
);

console.log('auth-state guards passed');
