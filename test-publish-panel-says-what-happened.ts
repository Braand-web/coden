import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * The publish panel never renders a dead end.
 *
 * A user sent a screenshot of it: title "Publication", button "Vérifier
 * d'abord", counter "Contrôles 0". Every one of those is the panel's
 * *no-status* rendering — `publishPanelTitle(null)` returns exactly
 * 'Publication', `publishPrimaryLabel` with no status returns 'Vérifier
 * d’abord', and `status?.checks || []` is empty. `buildPublishStatus` always
 * returns five checks, so a count of zero cannot come from a real status.
 *
 * The defect is not that the status was missing. It is that three different
 * situations rendered identically:
 *
 *   - the request is still in flight
 *   - the request failed
 *   - the response carried no status
 *
 * All three produced the same disabled button and the same title, so the panel
 * said nothing about which had happened and offered no way out of any of them.
 * "Vérifier d'abord" is worse than silence: it is an instruction the user
 * cannot follow, pointing at checks that were never received.
 *
 * This is the same failure mode as the four production outages found in this
 * codebase — a state that is wrong and indistinguishable from a state that is
 * fine. The fix is not to guess why the status was missing; it is to make each
 * case say what it is.
 */

const live = readFileSync(new URL('./src/builder-live.ts', import.meta.url), 'utf8');
const panel = live.slice(live.indexOf('function renderPublishPanel('), live.indexOf('async function openPublishPanel('));

// The three cases are distinguished at all, which they were not before.
{
  assert.match(panel, /function renderPublishPanel\(payload: PublishApiPayload \| null, isPublishing = false, error = '', loading = false\)/,
    'the panel is told whether the request is still in flight');
  assert.match(panel, /const statusMissing = !status && !loading;/,
    'and a response that carried no status is its own case, not the loading one');
}

/*
 * Loading says it is loading.
 *
 * The old first render passed `null` and was indistinguishable from failure:
 * the panel claimed "Vérifier d'abord" before the request had even returned.
 */
{
  assert.match(panel, /const title = loading \? 'Publication…' : publishPanelTitle\(status\);/, 'the title reflects a request in flight');
  assert.match(panel, /: loading\s*\n\s*\? 'Chargement…'/, 'and so does the button');
  assert.match(panel, /'Lecture de l’état de publication…'/, 'with a line saying what is happening');

  const open = live.slice(live.indexOf('async function openPublishPanel('), live.indexOf('async function shareProjectLink('));
  assert.match(open, /renderPublishPanel\(null, Boolean\(publishInFlight\), '', true\);/,
    'the render before the request declares itself as loading');
}

/*
 * A missing status says so, and offers the only remedy there is.
 *
 * A disabled button is a dead end; the panel's own way out is to ask again.
 */
{
  assert.match(panel, /\? 'Réessayer'/, 'the button becomes a retry rather than an instruction that cannot be followed');
  assert.match(panel, /data-publish-action="\$\{statusMissing \? 'reload' : 'publish'\}"/, 'and it retries rather than publishing');
  assert.match(panel, /\$\{statusMissing \|\| canPublish \? '' : 'disabled'\}/, 'and it is enabled, because retrying is always allowed');
  assert.match(panel, /'Le serveur n’a pas renvoyé d’état de publication\. Réessayez\.'/, 'a response with no status is named as such');
  assert.match(panel, /'L’état de publication n’a pas pu être lu\. Réessayez\.'/, 'and a failed request is distinguished from it');

  assert.match(panel, /if \(action === 'reload'\) void openPublishPanel\(\);/, 'the retry re-runs the request');
}

/*
 * The route answers when it fails, instead of ending the request with no body.
 *
 * An async Express handler that throws produces an unhandled rejection, not a
 * response. `getUserOrgId` throws without a session and `loadProjectFiles`
 * throws on any Supabase error that is not a missing table — neither was
 * caught, so the client got nothing and had nothing to show.
 */
{
  const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  const route = server.slice(
    server.indexOf("app.get('/api/projects/:id/publish/status'"),
    server.indexOf('// GET /projects/:id/deployments'),
  );

  assert.match(route, /\} catch \(error: any\) \{/, 'the route cannot end without an answer');
  assert.match(route, /diagnostic_code: 'PUBLISH_STATUS_UNAVAILABLE'/, 'the failure has a name');
  assert.match(route, /request_id: requestId/, 'and an identifier that ties it to a log line');
  assert.match(route, /\[coden:publish_status_failed\]/, 'which is actually logged');

  /*
   * Auth is deliberately NOT re-declared here: `app.use('/api/projects', …)`
   * already runs `requireProjectAuthWithTemporaryGeneration` for this path.
   * Adding `requireAuth` to the route would be a second, redundant check
   * dressed up as a fix — and this route's problem was never authentication.
   */
  assert.doesNotMatch(route, /publish\/status', requireAuth/, 'the global project middleware already authenticates this path');
  assert.match(server, /app\.use\('\/api\/projects', requireProjectAuthWithTemporaryGeneration\);/, 'and it is still registered');
}

/*
 * The local-preview stub describes the same shape as the route it stands in
 * for.
 *
 * It returned the status flat — `{success, state, checks, …}` — while the real
 * route returns `{success, publish: {…}, deployment}` and the panel reads
 * `payload?.publish`. So every field the stub carefully filled in was
 * unreachable, and the local preview rendered the same no-status panel as a
 * total failure. A stub whose contract differs from the real one tests
 * nothing and teaches the wrong shape.
 */
{
  const preview = readFileSync(new URL('./src/local-preview.ts', import.meta.url), 'utf8');
  const stub = preview.slice(preview.indexOf("isProjectPath(path, '/publish/status')"), preview.indexOf("isProjectPath(path, '/agent/runs')"));

  assert.match(stub, /publish: \{/, 'the status is nested where the client reads it');
  assert.match(stub, /deployment: null,/, 'and the deployment field the real route returns is present');
  assert.doesNotMatch(stub, /payload: \{\s*success: true,\s*state:/, 'the flat shape is gone');
}

console.log('publish panel says what happened tests passed');
