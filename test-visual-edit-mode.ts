import assert from 'node:assert/strict';
import { truncate, buildInstruction } from './src/visual-edit-mode.ts';

// truncate collapses whitespace and caps length with an ellipsis.
assert.equal(truncate('  hello   world  '), 'hello world');
assert.equal(truncate('x'.repeat(80)).length, 60);
assert.ok(truncate('x'.repeat(80)).endsWith('\u2026'));

// French instruction references the element text and selector.
const frInstruction = buildInstruction(
  { selector: 'button.cta', tag: 'button', text: 'Sign up' },
  true,
);
assert.ok(frInstruction.includes('button'));
assert.ok(frInstruction.includes('"Sign up"'));
assert.ok(frInstruction.includes('button.cta'));
assert.ok(/Modifie cet/i.test(frInstruction));

// English instruction without visible text falls back to the selector.
const enInstruction = buildInstruction(
  { selector: 'div#hero', tag: 'div', text: '' },
  false,
);
assert.ok(/Edit this element/i.test(enInstruction));
assert.ok(enInstruction.includes('div#hero'));

console.log('visual edit mode helpers ok');
