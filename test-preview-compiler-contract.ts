import assert from 'node:assert/strict';
import fs from 'node:fs';

// The preview compiles generated TypeScript/JSX in the browser with Babel
// standalone loaded from a CDN. That URL used to float on latest, so when
// Babel 8 removed the preset-typescript `isTSX` and `allExtensions` options,
// every preview in production broke at once — no deploy on our side, and a
// symptom ("Invalid or unexpected token") that named nothing.
//
// This test guards the two properties that failure depended on.
const server = fs.readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

// 1. The compiler is versioned like the runtime dependency it is.
assert.ok(
  /@babel\/standalone@\$\{CODEN_PREVIEW_BABEL_VERSION\}/.test(server),
  'the preview must load a pinned Babel build, never the CDN default',
);
assert.ok(
  /const CODEN_PREVIEW_BABEL_VERSION = '\d+\.\d+\.\d+'/.test(server),
  'the pinned Babel version must be an exact release',
);
assert.ok(
  !/unpkg\.com\/@babel\/standalone\/babel/.test(server),
  'no unpinned Babel URL may remain',
);

// 2. The removed options must not come back as options. TSX detection comes
//    from the filename, which the preview already passes. Only a real option
//    assignment counts here — the prose explaining the incident may name them.
for (const removed of ['isTSX', 'allExtensions']) {
  assert.ok(
    !new RegExp(`${removed}\\s*:`).test(server),
    `preset-typescript option "${removed}" was removed in Babel 8 and must not be passed`,
  );
}
assert.ok(
  server.includes('"typescript", { onlyRemoveTypeImports: true }'),
  'the preview must use preset-typescript options that exist in the pinned Babel',
);

// 3. A compiler that failed to load must say so, not surface as a bare
//    ReferenceError from inside the module loader.
assert.ok(
  server.includes('The preview compiler did not load'),
  'the preview must report a missing compiler explicitly',
);

// 4. Nothing may be spliced into the document by first-match replace. The
//    generated modules are embedded as a JSON literal earlier in the same
//    document, so a generated file containing `</body>` — a TanStack
//    `__root.tsx` renders one — made that the first match, and the injected
//    `</script>` ended the bootstrap in the middle of a string.
for (const pattern of [/replace\(\/<\\\/body>\/i/, /replace\(\/<\\\/head>\/i/]) {
  assert.ok(
    !pattern.test(server),
    `document injection must go through the preview-embedding helpers, not ${pattern}`,
  );
}
assert.ok(
  server.includes('insertBeforeBodyEnd(') && server.includes('insertBeforeHeadEnd('),
  'the preview must inject through the helpers that target the document\'s own tags',
);

console.log('preview compiler contract tests passed');
