import assert from 'node:assert/strict';
import { scriptSafeJson, styleSafeCss } from './src/services/preview-embedding.ts';

// Generated CSS that closes its own <style> element ended the element early,
// the document was reparsed as content, and the preview bootstrap stopped
// parsing — reported to the user as "Invalid or unexpected token" with a blank
// preview and a run stuck in needs_fix.
for (const closing of ['</style>', '</STYLE>', '</style ', '</style><script>alert(1)']) {
  const escaped = styleSafeCss(`.x::after { content: "${closing}"; }`);
  assert.ok(!/<\/style/i.test(escaped), `must neutralise ${closing}`);
  // `\/` is a valid CSS escape for `/`, so the declaration keeps its meaning.
  assert.ok(escaped.includes('<\\/'), `must escape rather than delete ${closing}`);
}

// Ordinary stylesheets must come through byte for byte.
for (const css of [
  '.todo { color: red; }',
  '@media (max-width: 640px) { main { padding: 1rem; } }',
  '.a::before { content: "a / b"; }',
  '',
]) {
  assert.equal(styleSafeCss(css), css, 'a clean stylesheet must not be rewritten');
}

// The same hazard for the inline module script.
for (const closing of ['</script>', '</SCRIPT>', '</script ']) {
  const escaped = scriptSafeJson(JSON.stringify({ 'src/App.tsx': { code: `const s = '${closing}';` } }));
  assert.ok(!/<\/script/i.test(escaped), `must neutralise ${closing}`);
  // Still valid JSON, and `\/` parses back to `/`, so the module is unchanged.
  const parsed = JSON.parse(escaped);
  assert.equal(parsed['src/App.tsx'].code, `const s = '${closing}';`);
}

assert.equal(scriptSafeJson(JSON.stringify({ a: 1 })), '{"a":1}');
assert.equal(styleSafeCss(null as unknown as string), '');
assert.equal(scriptSafeJson(undefined as unknown as string), '');

console.log('preview embedding tests passed');
