import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * A rendered preview must reach the screen even when verification is unhappy.
 *
 * The generate route saves the real rendering of the user's application on its
 * needs_fix path — `preview_html: previewHtml`, not an error page. The builder
 * then refused to draw anything whose status was not `verified`, so the user
 * got the words "Preview not verified" over an empty rectangle while a
 * complete rendering of their app sat unused in the payload. That is the
 * reported symptom: nothing appears in the preview.
 *
 * Showing it is only an improvement while the reader knows what they are
 * looking at, so the badge is asserted as strictly as the rendering.
 */

const builder = readFileSync('./src/builder-live.ts', 'utf8');
const setPreview = builder.slice(
  builder.indexOf('function setPreview(html: string'),
  builder.indexOf('function setPreviewFromProject') > 0
    ? builder.indexOf('function setPreviewFromProject')
    : builder.indexOf('function setPreview(html: string') + 2_000,
);

// The gate that made a needs_fix run invisible is gone...
assert.doesNotMatch(
  setPreview,
  /normalizedStatus !== 'verified'/,
  'setPreview must not require verified status: that is what blanked a rendered application',
);
// ...but a run still in flight keeps its loader, and useless html is still
// refused — showing a spinner or a fallback as if it were the app would be a
// different kind of lie.
assert.match(setPreview, /const stillWorking = normalizedStatus === 'building'/, 'a run in flight keeps its loader');
assert.match(setPreview, /!isUsablePreviewHtml\(html\)/, 'html that shows nothing useful is still refused');

// The controls act on the frame, so they follow what is on screen rather than
// what verification concluded.
const readyCheck = builder.slice(builder.indexOf('function hasReadyAppPreview'), builder.indexOf('function syncPreviewToolbarControls'));
assert.match(readyCheck, /\['verified', 'needs_fix', 'live'\]\.includes\(currentPreviewStatus\)/,
  'refresh and the device switcher must work on any displayed preview');

// The honesty half: an unverified preview says so.
assert.match(builder, /function syncPreviewTrustBadge/, 'an unverified preview must be labelled');
const badge = builder.slice(builder.indexOf('function syncPreviewTrustBadge'), builder.indexOf('function syncPreviewTrustBadge') + 1_400);
assert.match(badge, /Aperçu non vérifié/, 'in French');
assert.match(badge, /Unverified preview/, 'and in English');
assert.match(badge, /currentPreviewStatus === 'verified' \|\| currentPreviewStatus === 'live'/,
  'a verified or live preview carries no warning, or the badge means nothing');
assert.match(builder, /syncPreviewTrustBadge\(\);/, 'and it is actually called');

// It has to be visible, not merely present in the DOM.
const styles = readFileSync('./builder.html', 'utf8');
assert.match(styles, /\.preview-trust-badge \{/, 'the badge needs styling to be readable');
assert.match(styles, /\.preview-trust-badge::before \{/, 'and a shape, so it does not rely on colour alone');

// Reopening a project is not a generation, so the live URL never arrives in a
// payload there. Without asking, a sandbox left running from an earlier run
// stays invisible and the reader gets the saved rendering instead of the app.
assert.match(builder, /async function resumeLivePreview\(\)/, 'reopening a project must look for a running sandbox');
assert.match(builder, /void resumeLivePreview\(\);/, 'and actually call it on load');
const resume = builder.slice(builder.indexOf('async function resumeLivePreview'), builder.indexOf('/** Forget the live preview'));
assert.match(resume, /sandbox\/status/, 'by asking the status route');
assert.match(resume, /status\?\.state !== 'running'/, 'and only when a server is actually up');
assert.match(resume, /\} catch \{/, 'a server without the live sandbox answers 503; that is not an error to report');

console.log('unverified preview visibility tests passed');
