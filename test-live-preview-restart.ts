import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Getting a stopped application running again, without regenerating it.
 *
 * `resumeLivePreview` only reattaches to a dev server that is already up, and
 * a dev server does not survive a redeploy, an eviction, or the project being
 * left alone for an hour. So every project older than its sandbox fell back to
 * the saved rendering, and the only route back to a running application was to
 * build it again — a model call to rebuild what was already on disk.
 *
 * That gap is what makes the preview fix incomplete on projects that already
 * exist: their stored html was written by the old generate route, which
 * replaced the rendering with a placeholder, so there is nothing worth showing
 * and the server is the only source of truth left.
 */

const builder = readFileSync('./src/builder-live.ts', 'utf8');
const markup = readFileSync('./builder.html', 'utf8');

// The action exists and asks the route that actually starts a server.
assert.match(builder, /async function startLivePreview\(\)/, 'a stopped application must be startable from the interface');
const start = builder.slice(builder.indexOf('async function startLivePreview'), builder.indexOf('function syncLivePreviewStartControl'));
assert.match(start, /sandbox\/start/, 'by calling the start route');
assert.match(start, /method: 'POST'/, 'which is a POST');
assert.match(start, /setLivePreview\(url\)/, 'and the result points the panel at the running server');

// Starting takes a minute; a second click would start it twice.
assert.match(start, /if \(!currentProjectId \|\| liveStartInFlight\) return/, 'a start already under way must not be started again');
assert.match(builder, /let liveStartInFlight = false;/, 'the guard needs somewhere to live');
assert.match(start, /\} finally \{/, 'and must be released whatever happens, or the button stays dead');

// The route returns the install log and the dev server's own error. A generic
// notice would hide the one line naming the package or file at fault.
assert.match(start, /error\?\.message/, 'the failure the server reported is what the user is told');

/**
 * Offered when it is the thing to do, and not otherwise.
 *
 * On a running server the button would restart what the user is watching; on a
 * project with no files it can only fail; during a generation the run starts
 * one itself.
 */
const sync = builder.slice(builder.indexOf('function syncLivePreviewStartControl'), builder.indexOf('/** Forget the live preview'));
assert.match(sync, /!livePreviewUrl/, 'not offered while a server is already running');
assert.match(sync, /Boolean\(currentProjectId\)/, 'not offered without a project');
assert.match(sync, /!isGenerating/, 'not offered during a generation, which starts one itself');
assert.match(sync, /currentBuilderView === 'preview'/, 'and not over the code or database tabs');

// It has to follow the state rather than be set once.
assert.match(builder, /syncPreviewToolbarControls\(\) \{\n  syncLivePreviewStartControl\(\);/,
  'the control must follow every change the preview toolbar already follows');
const clear = builder.slice(builder.indexOf('function clearLivePreview'), builder.indexOf('function clearLivePreview') + 400);
assert.match(clear, /syncLivePreviewStartControl\(\)/, 'losing the server must bring the offer back');
const busy = builder.slice(builder.indexOf('function setBusy(busy: boolean)'), builder.indexOf('function setBusy(busy: boolean)') + 300);
assert.match(busy, /syncLivePreviewStartControl\(\)/, 'and a generation starting or ending must update it');

// Reopening a project with nothing running is the case this exists for.
const resume = builder.slice(builder.indexOf('async function resumeLivePreview'), builder.indexOf('/** Forget the live preview'));
assert.match(resume, /syncLivePreviewStartControl\(\); return;/, 'a project whose sandbox is gone must be offered the start control');

// And it has to be visible and operable, not merely defined.
assert.match(markup, /id="btn-live-preview-start"/, 'the button must exist in the page');
assert.match(markup, /\.preview-live-start-btn \{/, 'and be styled');
assert.match(builder, /getElementById\('btn-live-preview-start'\)\?\.addEventListener\('click'/, 'and be wired to the action');

console.log('live preview restart tests passed');
