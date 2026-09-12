import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * The preview shows the application, not an error page about it.
 *
 * A project generated on 2026-09-12 has twelve files, `preview_status:
 * verified`, a real 8 KB `src/App.tsx` and an `index.css` with its
 * `@tailwind` directives intact. The sandbox verification genuinely passed.
 * And its stored `preview_html` is 537 bytes:
 *
 *   Preview indisponible
 *   Le runtime réel n'a pas pu être vérifié.
 *   Unsafe file path blocked.
 *
 * One file was rejected out of twelve: `package-lock.json`. It sat in the same
 * blocklist as `..`, `.env` and `.git/`, and `runPreviewPipeline` treats an
 * unsafe path as a security error that replaces the entire preview. `npm
 * install` writes a lockfile into every sandbox, `readAllFiles` snapshots it,
 * so *every* generated project rendered that error instead of itself — while
 * still being marked verified, because the two judgements never met.
 *
 * A lockfile is not a threat. It is a file that nothing renders. Conflating
 * those two is what cost the product every preview it has ever produced.
 */

const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

// The two questions are asked separately, because they are different questions.
{
  const safe = server.slice(server.indexOf('function isSafeProjectFilePath('), server.indexOf('function normalizeGeneratedFiles('));

  assert.match(safe, /const blocked = \['\.env', '\.env\.local', 'node_modules\/', '\.git\/'\];/,
    'only genuine dangers block a path: traversal, secrets, VCS internals, installed dependencies');
  assert.doesNotMatch(safe, /package-lock\.json/, 'a lockfile is not a danger');
  assert.doesNotMatch(safe, /yarn\.lock/, 'nor is any other lockfile');

  // The dangers that must still block.
  assert.match(safe, /filePath\.includes\('\.\.'\)/, 'escaping the project root is still refused');
  assert.match(safe, /filePath\.startsWith\('\/'\)/, 'and so is an absolute path');
}

{
  const renderable = server.slice(server.indexOf('const UNRENDERED_PROJECT_PATHS'), server.indexOf('function isSafeProjectFilePath('));
  assert.match(renderable, /'package-lock\.json', 'pnpm-lock\.yaml', 'yarn\.lock'/, 'lockfiles are unrenderable, which is a separate fact');
  assert.match(renderable, /isSafeProjectFilePath\(filePath\)/, 'and renderable still implies safe');
}

/*
 * The preview filters rather than refuses.
 *
 * Excluding a lockfile from a render is housekeeping. Calling it unsafe raised
 * a security error, and a security error replaces the whole document.
 */
{
  const pipeline = server.slice(server.indexOf('function runPreviewPipeline('), server.indexOf('function runPreviewPipeline(') + 2600);

  assert.match(pipeline, /const renderable = files\.filter\(file => isRenderableProjectFilePath\(file\.path\)\);/,
    'unrenderable files are excluded before anything is judged');
  assert.match(pipeline, /for \(const file of renderable\)/, 'so they cannot raise an error');
  assert.match(pipeline, /renderPreviewHtml\(renderable,/, 'and are not embedded in the document');

  // Ninety kilobytes of JSON in a preview document is waste even when it is
  // harmless.
  assert.doesNotMatch(pipeline, /renderPreviewHtml\(files,/, 'the full file set never reaches the renderer');

  // A real unsafe path must still destroy the preview: that check is the point.
  assert.match(pipeline, /if \(!isSafeProjectFilePath\(file\.path\)\) \{/, 'genuine path safety is still enforced');
}

/*
 * A lockfile is now published with the project, and that is an improvement
 * rather than a side effect: `buildStaticSource` runs `npm install` on what it
 * is given, and a lockfile is what makes that install reproducible.
 */
{
  const normalize = server.slice(server.indexOf('function normalizeGeneratedFiles('), server.indexOf('function runPreviewPipeline('));
  assert.match(normalize, /isSafeProjectFilePath\(file\.path\)/, 'stored files are filtered on safety, not on renderability');
}

console.log('preview is the app tests passed');
