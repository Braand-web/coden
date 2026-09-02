import assert from 'node:assert/strict';
import {
  hasBlockingGeneratedImport,
  strippedOfBlockingMarkers,
} from './src/services/generated-blocking-markers.ts';

// The invariant that matters: anything the preview refuses, the repair must be
// able to clear. `missing-module` used to be detected but never stripped, so a
// project that hit it stayed in needs_fix forever and could never be published.
const blocking = [
  ["import { Todo } from '__missing_import__';\nimport React from 'react';\nexport const A = 1;", '__missing_import__'],
  ["import { Todo } from 'missing-module';\nimport React from 'react';\nexport const A = 1;", 'missing-module'],
  ["import { Todo } from './lib/missing-module';\nimport React from 'react';\nexport const A = 1;", 'relative path'],
  ["import Todo, { List } from '__missing_import__'\nexport const A = 1;", 'default + named, no semicolon'],
];

for (const [source, label] of blocking) {
  assert.equal(hasBlockingGeneratedImport(source), true, `${label} must be detected`);
  const repaired = strippedOfBlockingMarkers(source);
  assert.equal(hasBlockingGeneratedImport(repaired), false, `${label} must be repairable`);
  // Stripping only the `from` clause would leave `import { Todo }` behind and
  // turn a reported problem into a real syntax error.
  assert.ok(!/\bimport\b(?![^\n]*\bfrom\b)/.test(repaired), `${label} must not leave a dangling import`);
  assert.ok(repaired.includes('export const A = 1;'), `${label} must keep the rest of the file`);
}

// Forced runtime failure markers are cleared too, statement and bare token.
const forced = "throw new Error('__CODEN_FORCE_ERROR__');\nexport const B = 2;";
assert.ok(!strippedOfBlockingMarkers(forced).includes('__CODEN_FORCE_ERROR__'));
assert.ok(strippedOfBlockingMarkers(forced).includes('export const B = 2;'));

// Ordinary files must be left exactly as they are.
for (const clean of [
  "import React from 'react';\nexport default function App(){ return <h1>Tasks</h1>; }",
  "import { createClient } from '@supabase/supabase-js';\nexport const db = createClient(url, key);",
  'export const missingModuleCount = 0;',
]) {
  assert.equal(hasBlockingGeneratedImport(clean), false);
  assert.equal(strippedOfBlockingMarkers(clean), clean, 'a clean file must not be rewritten');
}

// A file with no import at all is never flagged, whatever words it contains.
assert.equal(hasBlockingGeneratedImport('const label = "missing-module";'), false);

console.log('generated blocking markers tests passed');
