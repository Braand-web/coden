import assert from 'node:assert/strict';
import { insertBeforeBodyEnd, insertBeforeHeadEnd, scriptSafeJson, styleSafeCss, tailwindThemeLiteral } from './src/services/preview-embedding.ts';

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


// An opening `<script` after an HTML comment puts the tokenizer in the
// double-escaped state, where `</script>` no longer closes the element — so the
// bootstrap swallows the rest of the document. Both sequences occur in ordinary
// generated code (a component holding an HTML string, a commented-out block).
for (const hazard of [
  '<!-- keep --> <script src="x">',
  '<script type="application/ld+json">{}',
  '<SCRIPT>',
  '<!--',
]) {
  const code = `export const shell = ${JSON.stringify(hazard)};`;
  const escaped = scriptSafeJson(JSON.stringify({ 'src/shell.ts': { code } }));
  assert.ok(!/<script/i.test(escaped), `must neutralise an opening tag in ${hazard}`);
  assert.ok(!escaped.includes('<!--'), `must neutralise an HTML comment in ${hazard}`);
  assert.equal(JSON.parse(escaped)['src/shell.ts'].code, code, 'the module source must survive byte for byte');
}

// Case is preserved through the escape, so the source is unchanged.
assert.equal(JSON.parse(scriptSafeJson(JSON.stringify({ s: '<Script><script>' }))).s, '<Script><script>');

// Injection must target the document's own closing tag, never one that appears
// inside the embedded module payload. A TanStack `__root.tsx` renders the
// document shell, so `</body>` sits inside the bootstrap's JSON literal; the
// old `html.replace(/<\/body>/i, …)` spliced a `<script>` block in there, ended
// the bootstrap mid-string, and the browser reported "Invalid or unexpected
// token" on every run.
const doc = [
  '<!doctype html><html><head><title>x</title></head><body>',
  '<script>window.__modules__ = {"src/routes/__root.tsx":{"code":"<html><body><Outlet /></body></html>"}};</script>',
  '</body></html>',
].join('\n');

const withBadge = insertBeforeBodyEnd(doc, '<a id="badge"></a>');
assert.ok(withBadge.indexOf('<a id="badge">') > withBadge.indexOf('window.__modules__'), 'the block must land after the payload');
assert.equal(withBadge.slice(withBadge.indexOf('<a id="badge">')).trim(), '<a id="badge"></a>\n</body></html>');
assert.ok(withBadge.includes('{"code":"<html><body><Outlet /></body></html>"}'), 'the payload must be untouched');

// Replacement-string specials in the block are literal, not expanded.
assert.ok(insertBeforeBodyEnd('<body></body>', "<i>$& $' $`</i>").includes("<i>$& $' $`</i>"));

// No body tag: append rather than lose the block.
assert.equal(insertBeforeBodyEnd('<div>x</div>', '<b>y</b>'), '<div>x</div>\n<b>y</b>');

// Head injection takes the document's own tag, which is the one before <body>.
const headDoc = '<html><head><title>t</title></head><body><script>var s = "</head>";</script></body></html>';
const withMeta = insertBeforeHeadEnd(headDoc, '<meta name="robots" content="noindex">');
assert.ok(withMeta.indexOf('<meta name="robots"') < withMeta.indexOf('<body>'), 'head block must stay in the head');
assert.equal(insertBeforeHeadEnd('<div>x</div>', '<meta>'), '<meta>\n<div>x</div>');

// The preview loads the Tailwind Play CDN with stock defaults, so an app that
// names its own tokens — QuickCalc uses bg-surface, text-primary, rounded-panel
// — renders unstyled unless the project's theme goes with it.
const realConfig = [
  "import type { Config } from 'tailwindcss';",
  '',
  'export default {',
  "  content: ['./index.html', './src/**/*.{ts,tsx}'],",
  '  theme: {',
  '    extend: {',
  '      colors: { codenCream: "#fcfbf8", codenInk: "#1c1c1c", codenBlue: "#2f6df6" },',
  "      borderRadius: { coden: '1.5rem' },",
  '    },',
  '  },',
  '  plugins: [],',
  '} satisfies Config;',
].join('\n');
const theme = tailwindThemeLiteral(realConfig);
assert.ok(theme, 'a plain theme must be extracted');
assert.ok(theme!.startsWith('{') && theme!.endsWith('}'), 'the extracted theme must be balanced');
assert.ok(theme!.includes('codenBlue') && theme!.includes("coden: '1.5rem'"), 'the whole theme must come through');
assert.ok(!theme!.includes('plugins'), 'nothing past the theme may be captured');

// The config is model-written code. Anything that computes is refused rather
// than embedded into the preview document.
for (const unsafe of [
  'export default { theme: { extend: require("./tokens") } };',
  'export default { theme: { colors: getColors() } };',
  'export default { theme: { spacing: (n) => n * 4 } };',
  'export default { theme: { content: `${base}/x` } };',
  'export default { content: [] };',
  '',
]) {
  assert.equal(tailwindThemeLiteral(unsafe), null, `must refuse: ${unsafe.slice(0, 40)}`);
}

// A brace inside a string must not end the theme early.
const quoted = tailwindThemeLiteral('export default { theme: { content: { raw: "a } b" }, x: 1 }, plugins: [] };');
assert.ok(quoted && quoted.includes('x: 1'), 'a brace inside a string must not close the literal');
assert.ok(quoted && !quoted.includes('plugins'), 'the literal must still stop at the theme');
assert.equal(tailwindThemeLiteral(null), null);

console.log('preview embedding tests passed');
