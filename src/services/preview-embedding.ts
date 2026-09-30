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

import { posix } from 'node:path';

type PreviewSourceFile = { path: string; content: string };

/**
 * Which renderer produced a saved preview document.
 *
 * A saved `preview_html` is a rendering of the project's files, and it is what
 * a reopened project shows first. When the renderer learns to reproduce
 * something it used to drop, every document saved before that is stale in the
 * same way: bump this and `refreshLegacyPreviewStyles` rebuilds them from the
 * stored files the next time they are opened.
 *   imports-v1: follows the app's CSS imports.
 *   theme-v2:   runs the project's Tailwind config instead of a literal subset.
 */
export const CODEN_PREVIEW_RENDERER_VERSION = 'theme-v2';

/**
 * Follow the generated app's imports instead of assuming its entire design
 * lives in index.css or App.css. The lightweight preview does not run Vite, so
 * CSS imports otherwise become no-ops in its module loader. Keep this confined
 * to in-memory project files; a generated path must never read from the host.
 */
export function collectPreviewStyles(files: PreviewSourceFile[]): {
  styles: PreviewSourceFile[];
  externalStylesheets: string[];
} {
  const byPath = new Map(files.map(file => [file.path.replace(/\\/g, '/').replace(/^\.\//, ''), file]));
  const styles: PreviewSourceFile[] = [];
  const externalStylesheets: string[] = [];
  const visitedModules = new Set<string>();
  const visitedStyles = new Set<string>();

  function resolve(from: string, specifier: string): string | null {
    const clean = specifier.split(/[?#]/, 1)[0].replace(/\\/g, '/');
    if (!clean || /^(?:[a-z]+:|\/\/)/i.test(clean)) return null;
    const base = clean.startsWith('@/') ? `src/${clean.slice(2)}`
      : clean.startsWith('/') ? clean.slice(1)
      : clean.startsWith('.') ? posix.join(posix.dirname(from), clean)
      : null;
    if (!base) return null;
    const normalized = posix.normalize(base);
    if (normalized === '..' || normalized.startsWith('../')) return null;
    for (const candidate of [normalized, ...['.tsx', '.ts', '.jsx', '.js', '.css', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'].map(ext => normalized + ext)]) {
      if (byPath.has(candidate)) return candidate;
      if (byPath.has(`public/${candidate}`)) return `public/${candidate}`;
    }
    return null;
  }

  function expandCss(path: string, stack = new Set<string>()): string {
    if (stack.has(path)) return '';
    const source = byPath.get(path)?.content || '';
    const nextStack = new Set(stack).add(path);
    return source.replace(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?([^;]*);/gi, (statement, _quote: string, specifier: string, conditions: string) => {
      const imported = resolve(path, specifier);
      if (!imported || !imported.endsWith('.css')) return statement;
      const content = expandCss(imported, nextStack);
      const condition = conditions.trim();
      if (!condition) return content;
      if (/^layer\([\w-]+\)$/i.test(condition)) return `@layer ${condition.slice(6, -1)} {\n${content}\n}`;
      if (/^(?:screen|print|all|\()/i.test(condition)) return `@media ${condition} {\n${content}\n}`;
      return statement;
    });
  }

  function visitStyle(path: string) {
    if (visitedStyles.has(path)) return;
    visitedStyles.add(path);
    styles.push({ path, content: expandCss(path) });
  }

  const importPattern = /\b(?:import|export)\s+(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  function visitModule(path: string) {
    if (visitedModules.has(path)) return;
    visitedModules.add(path);
    const code = byPath.get(path)?.content || '';
    for (const match of code.matchAll(importPattern)) {
      const imported = resolve(path, match[1] || match[2] || match[3]);
      if (!imported) continue;
      if (imported.endsWith('.css')) visitStyle(imported);
      else if (/\.[cm]?[jt]sx?$/.test(imported)) visitModule(imported);
    }
  }

  const index = byPath.get('index.html')?.content || '';
  for (const tag of index.match(/<link\b[^>]*>/gi) || []) {
    const rel = tag.match(/\brel\s*=\s*(['"])(.*?)\1/i)?.[2] || '';
    const href = tag.match(/\bhref\s*=\s*(['"])(.*?)\1/i)?.[2] || '';
    if (!/\bstylesheet\b/i.test(rel) || !href) continue;
    const local = resolve('index.html', href);
    if (local?.endsWith('.css')) visitStyle(local);
    else if (/^https:\/\/[^\s<>"']+$/i.test(href) && !externalStylesheets.includes(href)) externalStylesheets.push(href);
  }
  for (const [indexInHtml, match] of [...index.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].entries()) {
    styles.push({ path: `index.html#style-${indexInHtml}`, content: match[1] });
  }

  const entry = ['src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js', 'src/App.tsx', 'src/App.jsx'].find(path => byPath.has(path));
  if (entry) visitModule(entry);
  // Older generated apps sometimes omitted the import but relied on the
  // preview's historical treatment of these two conventional files.
  if (!visitedStyles.size) for (const path of ['src/index.css', 'src/App.css']) if (byPath.has(path)) visitStyle(path);

  return { styles, externalStylesheets };
}

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

/**
 * The generated project's Tailwind configuration, as an inline script that
 * sets `tailwind.config` for the Play CDN.
 *
 * `tailwindThemeLiteral` above can only embed a theme that is a plain object
 * literal, and Coden's own starter is not one: its colours are
 * `tone('--color-surface')`, a helper that builds a `color-mix()` around a CSS
 * variable, and its radii and shadows are `var(--radius-card)`. Every one of
 * those contains a parenthesis, so the literal was refused, the preview ran
 * stock Tailwind, and `bg-surface`, `text-secondary` and `rounded-card`
 * resolved to nothing — a saved app reopened looking unstyled although every
 * file was intact (63 of the 72 stored projects have such a theme).
 *
 * The config is model-written code, but it is code the preview already
 * trusts to that degree: the same document runs the app's own modules through
 * Babel inside a sandboxed frame. So the config is *run*, not parsed:
 *
 *  - imports and `require` become inert stand-ins (a plugin cannot load from
 *    a CDN anyway, and `plugins` is emptied afterwards);
 *  - `export default` / `module.exports` become a `return`;
 *  - the source travels as a JSON string handed to `new Function`, so no
 *    sequence in it can end the script element, and a config that does not
 *    evaluate is a caught error rather than a broken document.
 *
 * When evaluation fails the plain-literal theme, if there is one, still applies.
 * Returns null when there is no config to speak of.
 */
export function tailwindConfigScript(configSource: string | null | undefined): string | null {
  const original = String(configSource || '');
  if (!original.trim() || original.length > 80_000) return null;

  const bindings: string[] = [];
  let body = original
    .replace(/^\s*import\s+type\s[^;\n]*;?[ \t]*$/gm, '')
    .replace(/^\s*import\s+([\s\S]*?)\s+from\s*['"][^'"\n]+['"]\s*;?/gm, (_all, clause: string) => {
      const named = /\{([^}]*)\}/.exec(clause)?.[1];
      const rest = clause.replace(/\{[^}]*\}/, '');
      const namespace = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(rest)?.[1];
      const def = /^\s*([A-Za-z_$][\w$]*)/.exec(rest.replace(/\*\s*as\s+[A-Za-z_$][\w$]*/, ''))?.[1];
      if (def) bindings.push(def);
      if (namespace) bindings.push(namespace);
      for (const part of String(named || '').split(',')) {
        const local = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (local && /^[A-Za-z_$][\w$]*$/.test(local)) bindings.push(local);
      }
      return '';
    })
    .replace(/^\s*import\s*['"][^'"\n]+['"]\s*;?/gm, '')
    .replace(/\s+satisfies\s+[A-Za-z_$][\w$.]*(?:<[^>\n]*>)?/g, '')
    .replace(/\s+as\s+const\b/g, '')
    .replace(/^(\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*)\s*:\s*[^=\n]+?\s*=(?!=)/gm, '$1 =')
    // `(name: string): string =>` — the parameter and return annotations of a helper.
    .replace(/\(([^()]*)\)\s*(?::\s*[A-Za-z_$][\w$.<>[\]| ]*)?\s*=>/g, (_all, params: string) =>
      `(${params.split(',').map(param => param.replace(/\s*\??:\s*[^,=]+/, '')).join(',')}) =>`)
    .replace(/\bexport\s+default\s+/, 'return ')
    .replace(/\bmodule\.exports\s*=\s*/, 'return ')
    .replace(/^\s*export\s+(?=(?:const|let|var|function)\b)/gm, '');
  if (!/\breturn\b/.test(body)) return null;

  const declared = [...new Set(bindings)].filter(name => !/^(?:return|default|from)$/.test(name));
  const prelude = [
    'var __stub = new Proxy(function () {}, {',
    '  get: function (t, k) { if (k === Symbol.iterator) return function () { return [][Symbol.iterator](); }; if (k === Symbol.toPrimitive) return function () { return ""; }; if (k === "then") return undefined; return __stub; },',
    '  apply: function () { return __stub; }, construct: function () { return __stub; }',
    '});',
    'var require = function () { return __stub; };',
    ...(declared.length ? [`var ${declared.map(name => `${name} = __stub`).join(', ')};`] : []),
  ].join('\n');

  const literal = tailwindThemeLiteral(original);
  // The literal is model-written text too: it travels as a string, like the
  // config, so a `</script>` inside one of its values cannot end the element.
  const fallback = literal ? `window.tailwind.config = { theme: new Function(${scriptSafeJson(JSON.stringify(`return ${literal};`))})() };` : '';
  const source = JSON.stringify(`${prelude}\n${body}`);
  return [
    '(function () {',
    '  try {',
    `    var cfg = new Function(${scriptSafeJson(source)})();`,
    '    if (!cfg || typeof cfg !== "object") throw new Error("the config does not export an object");',
    '    cfg.plugins = []; delete cfg.content;',
    '    window.tailwind = window.tailwind || {};',
    '    window.tailwind.config = cfg;',
    '  } catch (error) {',
    '    console.warn("[coden preview] tailwind.config could not be evaluated:", error && error.message);',
    fallback ? `    try { window.tailwind = window.tailwind || {}; ${fallback} } catch (_) {}` : '',
    '  }',
    '})();',
  ].filter(Boolean).join('\n');
}
