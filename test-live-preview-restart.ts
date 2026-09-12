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
const horizonCss = readFileSync('./src/styles/coden-horizon-system.css', 'utf8');
assert.doesNotMatch(markup, /id="btn-live-preview-start"/, 'the manual preview start control must not be rendered');

// Recovery exists and asks the route that actually starts a server, but it is
// automatic rather than exposed as a second toolbar action.
assert.match(builder, /async function ensureLivePreview\(\)/, 'a stopped application must restart automatically');
const start = builder.slice(builder.indexOf('async function ensureLivePreview'), builder.indexOf('/** Forget the live preview'));
assert.match(start, /sandbox\/start/, 'by calling the start route');
assert.match(start, /method: 'POST'/, 'which is a POST');
assert.match(start, /setLivePreview\(url\)/, 'and the result points the panel at the running server');
/*
 * The restart is started, not awaited.
 *
 * This assertion used to pin `await ensureLivePreview()`. The behaviour it
 * protects — a missing runtime restarts by itself — is right and still holds;
 * the `await` was incidental to it and turned out to be expensive: that call
 * runs `npm install` and boots Vite, and awaiting it inside `loadProject` put
 * the whole install in front of the builder's first layout.
 */
assert.match(builder, /setEmptyPreviewState\('idle'\);[\s\S]{0,1400}?void ensureLivePreview\(\)/,
  'a missing runtime must restart automatically');
assert.doesNotMatch(builder, /await ensureLivePreview\(\)/, 'without blocking the builder on a dependency install');

// Starting takes a minute; a second click would start it twice.
assert.match(start, /if \(!currentProjectId \|\| liveStartInFlight\) return/, 'a start already under way must not be started again');
assert.match(builder, /let liveStartInFlight = false;/, 'the guard needs somewhere to live');
assert.match(start, /\} finally \{/, 'and must be released whatever happens, or the button stays dead');

// The route returns the install log and the dev server's own error. A generic
// notice would hide the one line naming the package or file at fault.
assert.match(start, /error\?\.message/, 'the failure the server reported is what the user is told');

/**
 * Recovery is automatic and the toolbar remains minimal.
 */
assert.doesNotMatch(builder, /function syncLivePreviewStartControl/, 'the removed manual control must not leave dead synchronization code');

// Reopening a project with nothing running is the case this exists for.
const resume = builder.slice(builder.indexOf('async function resumeLivePreview'), builder.indexOf('/** Forget the live preview'));
assert.match(resume, /if \(!url \|\| status\?\.state !== 'running'\) return false;/, 'a missing sandbox must fall through to automatic restart');
assert.match(builder, /const resumedLive = await resumeLivePreview\(\)/, 'resolve the live server before choosing a fallback runtime');
assert.match(builder, /event\.payload\.type === 'preview_ready'/, 'a verified live preview must arrive before the closing model recap');
assert.match(builder, /url\.pathname\.startsWith\('\/preview\/'\)/, 'only the authenticated same-origin preview proxy may control the iframe');
assert.match(builder, /if \(livePreviewUrl && frame\.src === target/, 'the terminal result must not reload the preview that preview_ready already displayed');
assert.match(builder, /!previewHtml && !liveUrl/, 'a live preview must not be replaced by the no-preview placeholder at completion');
assert.match(builder, /if \(revision !== previewRevision\) \{\s*if \(result.ok\) result.teardown\(\)/, 'a stale browser runtime must be disposed, not replace a newer server preview');
assert.match(builder, /if \(revision !== previewRevision\) return;\s*if \(booted\) return;/, 'a stale fallback may not overwrite the live iframe with srcdoc');

// Runtime recovery remains internal; the toolbar must stay minimal.
assert.doesNotMatch(markup, /id="btn-live-preview-start"/, 'the manual start button must not exist');

// The resize target remains easy to grab while the chat is open, but it may
// not paint a full-height seam over the preview after the chat is collapsed.
assert.match(builder, /handle\.style\.cssText = '[^']*background:transparent/, 'the resize hit area must not paint a resting divider');
assert.match(
  horizonCss,
  /\.workspace-body\.sidebar-collapsed #coden-sidebar-resizer\s*\{[\s\S]{0,160}display:\s*none\s*!important/,
  'the resize target must disappear with the collapsed sidebar',
);
assert.match(
  horizonCss,
  /@media \(max-width: 720px\)[\s\S]{0,500}#coden-sidebar-resizer\s*\{[\s\S]{0,120}display:\s*none\s*!important/,
  'the desktop resize target must not cross the mobile workspace',
);

console.log('live preview restart tests passed');
