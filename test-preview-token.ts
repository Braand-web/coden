import assert from 'node:assert/strict';

/**
 * The grant that travels in the preview URL.
 *
 * The iframe's own requests -- modules, assets, the hot-reload socket -- are
 * issued by the browser, so they carry no header we control. This token is
 * what stands between "the preview is embedded in the builder" and "anyone
 * who guesses a project id can read the running application".
 */

process.env.CODEN_PREVIEW_TOKEN_SECRET = 'test-secret-for-preview-tokens';
const { issuePreviewToken, readPreviewToken } = await import('./src/services/sandbox/preview-token.ts');

// A token round-trips to exactly the grant it was issued for.
const token = issuePreviewToken({ projectId: 'proj-1', userId: 'user-1' });
const grant = readPreviewToken(token);
assert.ok(grant, 'a freshly issued token must be readable');
assert.equal(grant!.projectId, 'proj-1');
assert.equal(grant!.userId, 'user-1');
assert.ok(grant!.expiresAt > Date.now());

// Everything malformed is refused, and refused the same way: a caller that
// could tell "bad signature" from "expired" would be telling an attacker how
// close a forgery got.
for (const bad of ['', 'nonsense', 'a.b', `${token}x`, token.replace(/.$/, 'A'), 'eyJwIjoieCJ9.', '.', '..']) {
  assert.equal(readPreviewToken(bad), null, `must refuse ${JSON.stringify(bad.slice(0, 24))}`);
}
assert.equal(readPreviewToken(undefined), null);
assert.equal(readPreviewToken(null), null);
assert.equal(readPreviewToken({ projectId: 'proj-1' }), null, 'an object is not a token');

// A payload edited to name another project no longer verifies -- this is the
// whole point of signing it rather than encoding it.
const [payload] = token.split('.');
const forgedPayload = Buffer.from(JSON.stringify({ p: 'someone-elses-project', u: 'user-1', e: Date.now() + 60_000 })).toString('base64url');
assert.equal(readPreviewToken(`${forgedPayload}.${token.split('.')[1]}`), null, 'a swapped payload must not verify');
assert.notEqual(payload, forgedPayload);

// Expiry is enforced on read, so a URL copied out of a network tab stops
// working rather than lasting as long as the project does.
const expired = issuePreviewToken({ projectId: 'proj-1', userId: 'user-1', ttlMs: -1_000 });
assert.equal(readPreviewToken(expired), null, 'an expired token is not a token');

// Two projects never share a grant.
const other = issuePreviewToken({ projectId: 'proj-2', userId: 'user-1' });
assert.notEqual(other, token);
assert.equal(readPreviewToken(other)!.projectId, 'proj-2');

// The token is URL-safe: it is a path segment, and a '/' or '+' in it would
// silently change which route matched.
assert.doesNotMatch(token, /[/+=]/, 'the token must survive being a path segment');

console.log('preview token tests passed');
