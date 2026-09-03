import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The preview document, and the one place its two audiences differ.
 *
 * `getProjectPreviewHtml` discarded a project's saved rendering whenever its
 * status was not `verified` and returned a placeholder reading "Preview
 * indisponible — le runtime réel n'a pas pu être vérifié". So a run that had
 * produced the application, rendered it and stored it showed its author a page
 * saying it could not be shown. That is what the product looked like from the
 * outside: broken.
 *
 * The correction is not "always show it". Production serves the public, and an
 * application that failed verification must not be published — that boundary
 * is the entire point of strict verification, and removing it to fix a preview
 * would trade a cosmetic problem for a real one. So the split is by audience,
 * and both halves are pinned here.
 */

const server = readFileSync('./server.ts', 'utf8');

const fn = server.slice(
  server.indexOf('function getProjectPreviewHtml(project: GeneratedProject'),
  server.indexOf('function createTemplateFiles'),
);
assert.ok(fn.length > 200, 'getProjectPreviewHtml must be findable');

// The author sees what was built...
assert.match(fn, /const servesThePublic = environment === 'production'/, 'the two audiences must be distinguished');
assert.match(
  fn,
  /project\.preview_html && \(verified \|\| !servesThePublic\)/,
  'preview must return the saved rendering whatever verification concluded',
);

// ...and the public does not, unless it passed.
assert.match(fn, /buildPreviewErrorHtml\(\{/, 'an unverified production request still gets the failure document');
assert.ok(
  fn.indexOf('const verified = ') < fn.indexOf('project.preview_html && (verified'),
  'the verified check must gate the production branch',
);

/**
 * The rendering has to survive being saved, too.
 *
 * The generate route used to overwrite it with a placeholder on the way to the
 * database, so even a corrected reader had nothing left to read. `preview_status`
 * carries the verdict; the html carries the application.
 */
assert.match(
  server,
  /preview_html: previewHtml,/,
  'the generate route must save the real rendering',
);
assert.doesNotMatch(
  server,
  /preview_html: verificationPassed \? previewHtml : buildPreviewErrorHtml/,
  'and must not replace it with a placeholder: the status already says it is unverified',
);

/**
 * Publishing is the boundary that must not move.
 *
 * `servePublishedSnapshot` is what a visitor of a published project reaches.
 * It asks for the production document, which is the branch that still refuses.
 */
const publish = server.slice(server.indexOf('async function servePublishedSnapshot'), server.indexOf('async function servePublishedSnapshot') + 600);
assert.match(publish, /getProjectPreviewHtml\(project, files, 'production'\)/, 'published projects must ask for the production document');

console.log('preview document tests passed');
