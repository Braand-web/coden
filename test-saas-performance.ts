import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * What made every page slow, pinned so it does not come back.
 */
const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
const island = readFileSync(new URL('./src/builder-conversation-island.tsx', import.meta.url), 'utf8');
const builder = readFileSync(new URL('./src/builder-live.ts', import.meta.url), 'utf8');
const navigation = readFileSync(new URL('./src/navigation-transitions.ts', import.meta.url), 'utf8');
const notFound = readFileSync(new URL('./404.html', import.meta.url), 'utf8');

// Responses go out compressed (event streams and previews excepted, see the unit test).
assert.match(server, /app\.use\(responseCompression\(\)\);/, 'responses are compressed');
assert.ok(server.indexOf('app.use(responseCompression());') < server.indexOf("app.use(express.static(staticDir"), 'before the static files are served');

// A verified session is not re-verified over the network on every call.
assert.match(server, /const VERIFIED_SESSION_TTL_MS = 30_000;/);
assert.match(server, /verifiedSessions\.get\(sessionKey\)/, 'requireAuth answers from the short-lived cache');
assert.match(server, /Math\.min\(Date\.now\(\) \+ VERIFIED_SESSION_TTL_MS, expiresAt \|\| Date\.now\(\)\)/, 'never past the token expiry');

// Opening a project does not wait on a bookkeeping write.
assert.match(server, /void upsertUserWorkspaceState\(userId, \{ last_project_id: project\.id/);

// KaTeX is fetched only for a message that holds math.
assert.doesNotMatch(island, /^import katex from "katex";/m, 'KaTeX is not in the chat bundle');
assert.match(island, /import\("katex"\)/, 'it is loaded on demand');

// The conversation renders before the preview runtime is resolved.
assert.ok(builder.indexOf('restoreMessages(payload);') < builder.indexOf('const resumedLive = await resumeLivePreview();'), 'messages first');

// Navigation animations never hold a link click while the document changes.
assert.match(navigation, /@view-transition\s*\{\s*navigation:\s*auto;/, 'supported browsers use native page transitions');
assert.doesNotMatch(navigation, /preventDefault\(|setTimeout\(/, 'navigation never waits on a JavaScript timer');
assert.doesNotMatch(navigation, /filter:\s*blur/, 'page transitions avoid costly filter animation');

// A missing public route is a real, self-contained Coden recovery page.
assert.match(notFound, /<meta name="robots" content="noindex, nofollow">/);
assert.match(notFound, /<title>Page introuvable \| Coden<\/title>/);
assert.match(notFound, /<main\b[^>]*aria-labelledby="page-title"/);
assert.match(notFound, /href="\/"/);
assert.match(notFound, /href="\/pricing\.html"/);
assert.match(notFound, /prefers-reduced-motion:\s*reduce/);
assert.doesNotMatch(notFound, /<script\b[^>]*\bsrc=|https?:\/\//i, 'the error page has no external script or third-party dependency');
assert.match(notFound, /try \{[\s\S]*?localStorage\.getItem\(key\)[\s\S]*?catch \{ return null; \}/, 'its inline theme enhancement tolerates unavailable storage');
assert.match(server, /res\.status\(404\)\.sendFile\(path\.join\(staticDir, '404\.html'\)/, 'unknown public routes receive an HTTP 404 and the branded page');

console.log('saas performance checks passed');
