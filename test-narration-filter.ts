import assert from 'node:assert/strict';
import { createNarrationFilter } from './src/services/narration-filter.ts';

/**
 * The failure this exists for: a build streamed the model's prose to the
 * conversation, the prose contained the whole generated application, and the
 * user read their app's source in the chat instead of seeing it run in the
 * preview.
 */

/** Feed fragments through one filter and return everything it let past. */
function run(fragments: string[]): string {
  const filter = createNarrationFilter();
  return fragments.map(filter).join('');
}

// -- prose passes through untouched ----------------------------------------
assert.equal(
  run(['Reading ', 'src/App.tsx before ', 'editing it.']),
  'Reading src/App.tsx before editing it.',
);

// -- a fenced block is dropped, the prose around it is kept -----------------
assert.equal(
  run(['Created the counter:\n', '```tsx\nexport default function App() {}\n```', '\nStarting the dev server.']),
  'Created the counter:\n\nStarting the dev server.',
);

// -- the realistic case: one fence split across many fragments -------------
// Network deltas do not respect markdown boundaries; the closing fence in
// particular tends to arrive one backtick at a time.
assert.equal(
  run(['Here is index.html:\n', '`', '`', '`html\n<!DOCTYPE html>\n<body>hi</body>\n', '`', '`', '`', '\nDone.']),
  'Here is index.html:\n\nDone.',
);

// -- inline code is prose, not a file --------------------------------------
assert.equal(
  run(['I called `useState` twice, then ', 'fixed the `key` prop.']),
  'I called `useState` twice, then fixed the `key` prop.',
);

// -- an unterminated block stays suppressed to the end ---------------------
// A run that dies mid-dump must not leak half a file into the conversation
// just because the closing fence never arrived.
assert.equal(
  run(['Writing it out:\n```ts\nconst a = 1;\n', 'const b = 2;\n', 'const c = 3;\n']),
  'Writing it out:\n',
);

// -- two blocks in one stream, prose between them --------------------------
assert.equal(
  run(['A:\n```\nfirst\n```\nB:\n```\nsecond\n```\nC.']),
  'A:\n\nB:\n\nC.',
);

// -- each run is independent ------------------------------------------------
// State leaking between runs would suppress a whole later build because an
// earlier one ended inside a fence.
const first = createNarrationFilter();
first('unterminated ```ts\nleft open');
const second = createNarrationFilter();
assert.equal(second('a fresh run says this'), 'a fresh run says this');

console.log('narration filter tests passed');
