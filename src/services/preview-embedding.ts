/**
 * Safe embedding of generated content into the preview document.
 *
 * Generated CSS and code are untrusted input: the model writes them, and any
 * sequence that closes the element it sits in escapes into the surrounding
 * document. A stylesheet carrying `</style>` ended the style element early, the
 * rest of the document was reparsed as content, and the preview bootstrap
 * script stopped parsing — surfacing as `SyntaxError: Invalid or unexpected
 * token` with a blank preview and a run stuck in needs_fix.
 */

/**
 * Neutralize any sequence that would end the `<style>` element.
 *
 * `\/` is a valid CSS escape for `/`, so the declaration keeps its meaning
 * while the HTML tokenizer no longer sees a closing tag.
 */
export function styleSafeCss(css: string): string {
  return String(css || '').replace(/<\/(style)/gi, '<\\/$1');
}

/**
 * Neutralize every sequence that would derail the inline `<script>` element.
 *
 * Three sequences matter, and all three appear in ordinary generated code.
 * `</script` ends the element. `<!--` puts the tokenizer in the escaped state
 * and `<script` then puts it in the double-escaped state, where `</script>`
 * stops closing the element at all — so a file carrying an HTML comment and the
 * word `<script` swallows our own closing tag and breaks the document.
 *
 * Applied to a JSON literal, where `\/` escapes `/` and `\u002d` is `-`, so the
 * embedded value parses back byte for byte.
 */
export function scriptSafeJson(json: string): string {
  return String(json || '')
    .replace(/<\/(script)/gi, '<\\/$1')
    .replace(/<(s)(cript)/gi, (_match, first: string, rest: string) =>
      `<\\u00${first.charCodeAt(0).toString(16)}${rest}`)
    .replace(/<!--/g, '<!\\u002d\\u002d');
}

/**
 * Splice a block in before the document's own closing `</body>`.
 *
 * The preview embeds every generated module as a JSON literal inside an inline
 * script, so the generated source is part of the document text. Injecting with
 * `html.replace(/<\/body>/i, …)` targets the *first* `</body>`, and any app
 * whose source contains that text — a TanStack `__root.tsx` rendering the
 * document shell, a component holding an HTML string — puts one inside that
 * payload. The injected `</script>` then ended the bootstrap in the middle of a
 * JSON string, so the browser reported `SyntaxError: Invalid or unexpected
 * token`, the rest of the bootstrap was reparsed as page text, and the run went
 * to needs_fix with no repair able to clear it.
 *
 * The document's own `</body>` is the last one by construction: everything the
 * preview embeds is written before it. Splicing by index also keeps the block
 * literal — `String.replace` would interpret `$&` and `$'` inside it.
 */
export function insertBeforeBodyEnd(html: string, block: string): string {
  const source = String(html || '');
  const at = source.toLowerCase().lastIndexOf('</body>');
  if (at < 0) return `${source}\n${block}`;
  return `${source.slice(0, at)}${block}\n${source.slice(at)}`;
}

/**
 * Splice a block in before the document's own closing `</head>`.
 *
 * Same hazard, opposite end: here the document's tag is the first one that
 * closes before the body opens, since anything after `<body` is content.
 */
export function insertBeforeHeadEnd(html: string, block: string): string {
  const source = String(html || '');
  const lower = source.toLowerCase();
  const bodyAt = lower.search(/<body[\s>]/);
  let at = lower.indexOf('</head>');
  if (at < 0) return `${block}\n${source}`;
  if (bodyAt >= 0 && at > bodyAt) {
    const before = lower.slice(0, bodyAt).lastIndexOf('</head>');
    at = before >= 0 ? before : at;
  }
  return `${source.slice(0, at)}${block}\n${source.slice(at)}`;
}

/**
 * The generated project's Tailwind theme, as a literal safe to embed.
 *
 * The preview loads the Tailwind Play CDN with no configuration, so every token
 * the app defines for itself — `bg-surface`, `text-primary`, `rounded-panel`,
 * `font-display` — resolves to nothing and the preview renders unstyled even
 * when the code is correct. The project's own `tailwind.config` holds the
 * answer, so the preview should use it.
 *
 * The config is model-written code, so only a plain object literal is accepted:
 * anything with a call, a template literal, an arrow, a require or an import is
 * refused rather than embedded. Returns null when there is no usable theme.
 */
export function tailwindThemeLiteral(configSource: string | null | undefined): string | null {
  const source = String(configSource || '');
  const key = source.search(/(^|[\s,{])theme\s*:/);
  if (key < 0) return null;
  const open = source.indexOf('{', source.indexOf('theme', key));
  if (open < 0) return null;

  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      i += 1;
      while (i < source.length && source[i] !== quote) i += source[i] === '\\' ? 2 : 1;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) return null;

  const literal = source.slice(open, end);
  // A theme that computes something is not a literal we can trust to embed.
  if (/[`()]|=>|\brequire\b|\bimport\b|\bfunction\b|\bnew\b/.test(literal)) return null;
  if (!/[a-z]/i.test(literal)) return null;
  return literal;
}
