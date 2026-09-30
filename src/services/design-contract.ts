/**
 * The design contract: one source of truth for how a generated app looks.
 *
 * A generated project's design is not a setting stored somewhere; it is a
 * layer of ordinary files — the custom properties in its global stylesheet,
 * the Tailwind config that maps them to utilities, the font link in
 * `index.html`, and the import that loads the stylesheet at all. Every
 * component is written against that layer (`bg-surface`, `rounded-card`), so
 * the app keeps its look exactly as long as the layer survives.
 *
 * It did not survive iterations. The agent that changes "the pricing section"
 * has the same `write_file` as the one that built the app, and rewriting
 * `src/index.css` "to add a class" quietly drops the tokens every other
 * component reads; nothing in the run knew those tokens mattered. This module
 * makes them known:
 *
 *  - `extractDesignContract` reads the layer out of a set of files;
 *  - `renderDesignContract` puts it in front of the agent at every iteration;
 *  - `checkDesignWrite` refuses, at write time, a change that removes or
 *    repurposes it, with a hint the agent can act on;
 *  - `compareDesign` + `restoreDesign` are the net under that: after the run,
 *    anything that still went missing is put back — additively, so the new
 *    work in the same files is left alone.
 *
 * Pure functions over `{ path, content }` pairs: no I/O, no model, testable.
 */

import { createHash } from 'node:crypto';

export type DesignFile = { path: string; content: string };

export type TokenEntry = {
  file: string;
  /** The at-rules and selector the declaration sits in, outermost first. */
  stack: string[];
  name: string;
  value: string;
};

export type DesignContract = {
  version: 1;
  tokens: TokenEntry[];
  /** Full `<link>` tags for web fonts, so a lost one can be put back verbatim. */
  fontLinks: string[];
  fonts: string[];
  /** Keys the Tailwind config defines, as `section.key` (`colors.surface`). */
  themeKeys: string[];
  /** The global stylesheet the app entry imports, when there is one. */
  stylesheet: string | null;
  entry: string | null;
  importsStylesheet: boolean;
  tailwindDirectives: 'v3' | 'v4' | null;
  fingerprint: string;
};

export type DesignViolation =
  | { kind: 'token_removed'; file: string; stack: string[]; name: string; before: string }
  | { kind: 'token_changed'; file: string; stack: string[]; name: string; before: string; after: string }
  | { kind: 'font_removed'; family: string }
  | { kind: 'theme_key_removed'; key: string }
  | { kind: 'stylesheet_not_imported'; stylesheet: string; entry: string }
  | { kind: 'tailwind_directives_removed'; stylesheet: string; flavour: 'v3' | 'v4' };

const norm = (path: string) => String(path || '').replace(/\\/g, '/').replace(/^\.\//, '');
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

const isCss = (path: string) => /\.css$/i.test(path);
const isTailwindConfig = (path: string) => /^tailwind\.config\.[cm]?[jt]s$/i.test(norm(path));
const ENTRY_CANDIDATES = ['src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js', 'src/index.tsx', 'src/index.jsx'];

/** Selectors whose custom properties are the app's tokens rather than one component's local state. */
const GLOBAL_SCOPE = /^(?::root|html|body|\*|\[data-theme[^\]]*\]|\[data-mode[^\]]*\]|\.dark|\.light|@theme(?:\s+inline)?|@theme\s+static)$/i;

function partIsGlobal(part: string): boolean {
  const selector = part.trim();
  if (GLOBAL_SCOPE.test(selector)) return true;
  // `:root[data-theme="dark"]`, `html.dark` — the same scope with a qualifier.
  const bare = selector.replace(/^(?::root|html|body)(?=[[.])/i, '');
  return bare !== selector && GLOBAL_SCOPE.test(bare);
}

function isGlobalScope(stack: string[]): boolean {
  const parts = (stack[stack.length - 1] || '').split(',').map(part => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(partIsGlobal);
}

/** Every custom property declared in global scope, with where it sits. Comments and strings are not code. */
export function extractCssTokens(file: string, css: string): TokenEntry[] {
  const source = String(css || '');
  const tokens: TokenEntry[] = [];
  const stack: string[] = [];
  let buffer = '';
  let i = 0;
  const flushDeclaration = () => {
    const text = buffer.trim();
    buffer = '';
    if (!text.startsWith('--')) return;
    const colon = text.indexOf(':');
    if (colon < 0) return;
    const name = text.slice(0, colon).trim();
    if (!/^--[\w-]+$/.test(name)) return;
    if (!isGlobalScope(stack)) return;
    // `@layer` wrappers and quote style are how a stylesheet is organised, not
    // what a token is: moving `:root` into a layer must not read as removing it.
    tokens.push({
      file: norm(file),
      stack: stack.filter(part => !/^@layer\b/i.test(part)).map(part => part.replace(/'/g, '"')),
      name,
      value: collapse(text.slice(colon + 1)),
    });
  };
  while (i < source.length) {
    const char = source[i];
    if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      buffer += char;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') { buffer += source[i]; i += 1; }
        if (i < source.length) { buffer += source[i]; i += 1; }
      }
      if (i < source.length) { buffer += source[i]; i += 1; }
      continue;
    }
    if (char === '(') {
      // url(data:...;base64,...) and calc(...) hold `;` and `{` that are not structure.
      let depth = 0;
      while (i < source.length) {
        const c = source[i];
        buffer += c;
        i += 1;
        if (c === '(') depth += 1;
        else if (c === ')') { depth -= 1; if (depth === 0) break; }
      }
      continue;
    }
    if (char === '{') {
      stack.push(collapse(buffer));
      buffer = '';
    } else if (char === '}') {
      flushDeclaration();
      stack.pop();
    } else if (char === ';') {
      flushDeclaration();
    } else {
      buffer += char;
    }
    i += 1;
  }
  return tokens;
}

/** The names a Tailwind config defines under its theme sections, without running the config. */
export function extractThemeKeys(config: string): string[] {
  const source = String(config || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const SECTIONS = ['colors', 'borderRadius', 'boxShadow', 'fontFamily', 'fontSize', 'spacing', 'screens', 'keyframes', 'animation',
    'transitionDuration', 'transitionTimingFunction', 'maxWidth', 'borderColor', 'backgroundImage', 'zIndex'];
  const keys = new Set<string>();
  for (const section of SECTIONS) {
    const pattern = new RegExp(`(^|[\\s,{])${section}\\s*:\\s*\\{`, 'g');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const open = match.index + match[0].length - 1;
      let depth = 0;
      let i = open;
      let key = '';
      let atKeyPosition = true;
      for (; i < source.length; i += 1) {
        const char = source[i];
        if (char === '"' || char === "'" || char === '`') {
          const quote = char;
          let text = '';
          i += 1;
          while (i < source.length && source[i] !== quote) { text += source[i]; i += source[i] === '\\' ? 2 : 1; }
          if (depth === 1 && atKeyPosition) key = text;
          continue;
        }
        if (char === '{' || char === '[' || char === '(') { depth += 1; if (depth > 1) atKeyPosition = false; continue; }
        if (char === '}' || char === ']' || char === ')') { depth -= 1; if (depth === 0) break; continue; }
        if (depth !== 1) continue;
        if (char === ',') { atKeyPosition = true; key = ''; continue; }
        if (char === ':' && atKeyPosition) {
          const name = key || /([\w$-]+)\s*$/.exec(source.slice(open, i))?.[1] || '';
          if (name && !name.startsWith('...')) keys.add(`${section}.${name}`);
          atKeyPosition = false;
          key = '';
          continue;
        }
        if (atKeyPosition && /[\w$-]/.test(char)) key += char;
      }
    }
  }
  return [...keys].sort();
}

function fontLinks(html: string): { tags: string[]; families: string[] } {
  const tags: string[] = [];
  const families = new Set<string>();
  for (const tag of String(html || '').match(/<link\b[^>]*>/gi) || []) {
    const href = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2] || '';
    if (!/fonts\.googleapis\.com\/css2?\b|fonts\.bunny\.net|api\.fontshare\.com/i.test(href) || !/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    tags.push(tag);
    for (const family of href.matchAll(/[?&]family=([^&:;]+)/g)) families.add(decodeURIComponent(family[1].replace(/\+/g, ' ')));
  }
  return { tags, families: [...families].sort() };
}

function entryImportsCss(files: Map<string, DesignFile>): { entry: string | null; stylesheet: string | null } {
  const entry = ENTRY_CANDIDATES.find(path => files.has(path)) || null;
  if (!entry) return { entry: null, stylesheet: null };
  const imports = [...files.get(entry)!.content.matchAll(/import\s+(?:[^'";]*?\bfrom\s*)?['"]([^'"]+\.css)['"]/g)].map(match => match[1]);
  const first = imports[0];
  if (!first) return { entry, stylesheet: null };
  const base = first.startsWith('@/') ? `src/${first.slice(2)}` : first.startsWith('.') ? norm(`${entry.split('/').slice(0, -1).join('/')}/${first}`) : first;
  const resolved = base.split('/').reduce<string[]>((parts, part) => {
    if (part === '..') parts.pop(); else if (part !== '.' && part !== '') parts.push(part);
    return parts;
  }, []).join('/');
  return { entry, stylesheet: resolved };
}

export function extractDesignContract(input: readonly DesignFile[]): DesignContract {
  const files = new Map(input.map(file => [norm(file.path), { path: norm(file.path), content: String(file.content ?? '') }]));
  const tokens: TokenEntry[] = [];
  let directives: 'v3' | 'v4' | null = null;
  for (const file of files.values()) {
    if (!isCss(file.path)) continue;
    // A custom property declared twice in one file has the value of the last
    // declaration; that is the token, and the only one worth comparing.
    const effective = new Map<string, TokenEntry>();
    for (const entry of extractCssTokens(file.path, file.content)) effective.set(`${entry.stack.join('>')}|${entry.name}`, entry);
    tokens.push(...effective.values());
    if (/@tailwind\s+(?:base|components|utilities)\b/.test(file.content)) directives = 'v3';
    else if (!directives && /@import\s+['"]tailwindcss['"]|@theme\b/.test(file.content)) directives = 'v4';
  }
  const html = files.get('index.html')?.content || '';
  const { tags, families } = fontLinks(html);
  const configFile = [...files.values()].find(file => isTailwindConfig(file.path));
  const themeKeys = configFile ? extractThemeKeys(configFile.content) : [];
  const { entry, stylesheet } = entryImportsCss(files);
  const contract = {
    version: 1 as const,
    tokens: tokens.sort((a, b) => `${a.file}|${a.stack.join('>')}|${a.name}`.localeCompare(`${b.file}|${b.stack.join('>')}|${b.name}`)),
    fontLinks: tags,
    fonts: families,
    themeKeys,
    stylesheet,
    entry,
    importsStylesheet: Boolean(stylesheet && files.has(stylesheet)),
    tailwindDirectives: directives,
  };
  // One value per token across the project, as the cascade would settle it.
  const settled = new Map(contract.tokens.map(token => [`${token.stack.join('>')}|${token.name}`, token.value]));
  const fingerprint = createHash('sha256').update(JSON.stringify({
    tokens: [...settled].sort(([a], [b]) => a.localeCompare(b)),
    fonts: contract.fonts,
    themeKeys: contract.themeKeys,
    directives,
  })).digest('hex').slice(0, 16);
  return { ...contract, fingerprint };
}

const tokenKey = (entry: { stack: string[]; name: string }) => `${entry.stack.join('>')}|${entry.name}`;

/** What `after` lost or repurposed compared with `before`. Additions are never a violation. */
export function compareDesign(before: DesignContract, after: DesignContract, options: { allowValueChanges?: boolean } = {}): DesignViolation[] {
  const violations: DesignViolation[] = [];
  const now = new Map(after.tokens.map(token => [tokenKey(token), token]));
  for (const token of before.tokens) {
    const current = now.get(tokenKey(token));
    if (!current) violations.push({ kind: 'token_removed', file: token.file, stack: token.stack, name: token.name, before: token.value });
    else if (current.value !== token.value && !options.allowValueChanges) {
      violations.push({ kind: 'token_changed', file: token.file, stack: token.stack, name: token.name, before: token.value, after: current.value });
    }
  }
  if (!options.allowValueChanges) {
    for (const family of before.fonts) if (!after.fonts.includes(family)) violations.push({ kind: 'font_removed', family });
  }
  for (const key of before.themeKeys) if (!after.themeKeys.includes(key)) violations.push({ kind: 'theme_key_removed', key });
  if (before.importsStylesheet && before.stylesheet && before.entry && !after.importsStylesheet) {
    violations.push({ kind: 'stylesheet_not_imported', stylesheet: before.stylesheet, entry: before.entry });
  }
  if (before.tailwindDirectives && !after.tailwindDirectives) {
    violations.push({ kind: 'tailwind_directives_removed', stylesheet: before.stylesheet || 'src/index.css', flavour: before.tailwindDirectives });
  }
  return violations;
}

/** Does this request ask for a different look? Liberal on purpose: a false yes only relaxes value changes. */
export function wantsDesignChange(prompt: string): boolean {
  return /\b(couleurs?|colou?rs?|palette|th[eè]mes?|themes?|dark ?mode|light ?mode|mode (?:sombre|clair|nuit)|fond (?:noir|blanc|sombre|clair)|polices?|typo(?:graphie)?|fonts?|typeface|styles?|styling|design|look|refonte|redesign|rebrand|identit[eé]|branding|arrondi|radius|ombres?|shadows?|animations?|moderne|modern|joli|plus beau|beautiful|sobre|luxe|luxury|minimal|d[eé]grad[eé]|gradient|apparence|habill|ui\b|ux\b|contraste|contrast)/i.test(String(prompt || ''));
}

/** Where a change to `path` can touch the design layer at all. */
export function isDesignLayerPath(path: string): boolean {
  const p = norm(path);
  return isCss(p) || isTailwindConfig(p) || p === 'index.html' || ENTRY_CANDIDATES.includes(p);
}

export type DesignWriteVerdict =
  | { ok: true }
  | { ok: false; error: string; hint: string; violations: DesignViolation[] };

function describeViolation(violation: DesignViolation): string {
  switch (violation.kind) {
    case 'token_removed': return `removes ${violation.name}`;
    case 'token_changed': return `changes ${violation.name} (${violation.before} → ${violation.after})`;
    case 'font_removed': return `removes the "${violation.family}" font link`;
    case 'theme_key_removed': return `removes the Tailwind theme key ${violation.key}`;
    case 'stylesheet_not_imported': return `stops ${violation.entry} from importing ${violation.stylesheet}`;
    case 'tailwind_directives_removed': return `removes the Tailwind directives from ${violation.stylesheet}`;
  }
}

/**
 * Decide, before a write lands, whether it damages the design layer.
 *
 * Judged on the one file being written, against what it holds now: extending
 * a stylesheet is fine, dropping the tokens the rest of the app reads is not.
 * `allowValueChanges` is true when the user asked for a different look (or the
 * first build is still designing it) — a token may then take a new value, but
 * never disappear, since components name it.
 */
export function checkDesignWrite(input: { path: string; before: string | null; after: string; allowValueChanges: boolean; siblings?: readonly DesignFile[] }): DesignWriteVerdict {
  const path = norm(input.path);
  if (!isDesignLayerPath(path) || input.before === null) return { ok: true };
  const siblings = (input.siblings || []).filter(file => norm(file.path) !== path).map(file => ({ path: norm(file.path), content: file.content }));
  // An entry is judged on whether it still imports the stylesheet, which needs
  // the stylesheet to exist: stand in for it, so no sibling has to be read.
  if (ENTRY_CANDIDATES.includes(path)) {
    const { stylesheet } = entryImportsCss(new Map([[path, { path, content: input.before }]]));
    if (stylesheet && !siblings.some(file => file.path === stylesheet)) siblings.push({ path: stylesheet, content: '' });
  }
  const before = extractDesignContract([...siblings, { path, content: input.before }]);
  const after = extractDesignContract([...siblings, { path, content: input.after }]);
  // Only what this file is responsible for: a sibling's state is not this write's doing.
  const violations = compareDesign(before, after, { allowValueChanges: input.allowValueChanges })
    .filter(violation => !('file' in violation) || violation.file === path);
  if (!violations.length) return { ok: true };
  const list = violations.slice(0, 5).map(describeViolation).join('; ') + (violations.length > 5 ? `; and ${violations.length - 5} more` : '');
  return {
    ok: false,
    violations,
    error: `That write would damage the design layer of ${path}: it ${list}.`,
    hint: input.allowValueChanges
      ? `Keep every existing token, theme key and font link — change a value, do not delete the name. Use edit_file to change one declaration, or add the new tokens beside the old ones.`
      : `${path} holds the project's design tokens, and the user did not ask for a different look. Use edit_file to add a class or a new token beside the existing ones; do not rewrite the file or remove what is there. If the request really is about the look, say so in your reply and change only the values that need it.`,
  };
}

function nest(stack: string[], declarations: string[]): string {
  let block = declarations.map(line => `  ${line}`).join('\n');
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    block = `${stack[index]} {\n${block}\n}`;
    if (index > 0) block = block.split('\n').map(line => `  ${line}`).join('\n');
  }
  return block;
}

export type DesignRestoration = { files: DesignFile[]; restored: DesignViolation[]; unrepaired: DesignViolation[] };

/**
 * Put back what a run took from the design layer, without touching its other work.
 *
 * Tokens are re-declared in a block appended to the stylesheet they came from
 * (a later declaration of the same custom property wins, so the value returns
 * and every class the run added stays). A stylesheet that was deleted comes
 * back whole. The stylesheet import, the Tailwind directives and the font
 * link are re-inserted where they belong. A removed Tailwind theme key cannot
 * be spliced back into arbitrary code, so the config returns as it was.
 */
export function restoreDesign(baseline: readonly DesignFile[], current: readonly DesignFile[], violations: readonly DesignViolation[]): DesignRestoration {
  const files = new Map(current.map(file => [norm(file.path), { path: norm(file.path), content: String(file.content ?? '') }]));
  const base = new Map(baseline.map(file => [norm(file.path), { path: norm(file.path), content: String(file.content ?? '') }]));
  const restored: DesignViolation[] = [];
  const unrepaired: DesignViolation[] = [];

  const tokenViolations = violations.filter((violation): violation is Extract<DesignViolation, { kind: 'token_removed' | 'token_changed' }> => violation.kind === 'token_removed' || violation.kind === 'token_changed');
  const byFile = new Map<string, typeof tokenViolations>();
  for (const violation of tokenViolations) byFile.set(violation.file, [...(byFile.get(violation.file) || []), violation]);
  for (const [file, list] of byFile) {
    if (!files.has(file)) {
      const original = base.get(file);
      if (original) { files.set(file, original); restored.push(...list); } else unrepaired.push(...list);
      continue;
    }
    const groups = new Map<string, { stack: string[]; lines: string[] }>();
    for (const violation of list) {
      const key = violation.stack.join('>');
      const group = groups.get(key) || { stack: violation.stack, lines: [] };
      group.lines.push(`${violation.name}: ${violation.before};`);
      groups.set(key, group);
    }
    const blocks = [...groups.values()].map(group => nest(group.stack, group.lines));
    const target = files.get(file)!;
    // A removed `@import` must stay first, so the block goes last: after the run's own rules.
    files.set(file, { path: file, content: `${target.content.replace(/\s*$/, '')}\n\n/* Design tokens restored by Coden: this change removed them. */\n${blocks.join('\n\n')}\n` });
    restored.push(...list);
  }

  for (const violation of violations) {
    if (violation.kind === 'stylesheet_not_imported') {
      const entry = files.get(violation.entry);
      if (!entry) {
        const original = base.get(violation.entry);
        if (original) { files.set(violation.entry, original); restored.push(violation); } else unrepaired.push(violation);
        continue;
      }
      if (!files.has(violation.stylesheet)) {
        const original = base.get(violation.stylesheet);
        if (original) files.set(violation.stylesheet, original);
      }
      const spec = `./${violation.stylesheet.replace(/^src\//, '')}`;
      const lines = entry.content.split('\n');
      let lastImport = -1;
      lines.forEach((line, index) => { if (/^\s*import\b/.test(line)) lastImport = index; });
      lines.splice(lastImport + 1, 0, `import '${spec}';`);
      files.set(violation.entry, { path: violation.entry, content: lines.join('\n') });
      restored.push(violation);
    } else if (violation.kind === 'tailwind_directives_removed') {
      const sheet = files.get(violation.stylesheet);
      if (!sheet) { unrepaired.push(violation); continue; }
      const directives = violation.flavour === 'v3' ? '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n' : '@import "tailwindcss";\n\n';
      files.set(violation.stylesheet, { path: violation.stylesheet, content: directives + sheet.content });
      restored.push(violation);
    } else if (violation.kind === 'font_removed') {
      const html = files.get('index.html');
      const original = fontLinks(base.get('index.html')?.content || '').tags.find(tag => fontLinks(tag).families.includes(violation.family));
      if (!html || !original) { unrepaired.push(violation); continue; }
      if (!html.content.includes(original)) {
        const at = html.content.toLowerCase().indexOf('</head>');
        files.set('index.html', { path: 'index.html', content: at < 0 ? `${original}\n${html.content}` : `${html.content.slice(0, at)}    ${original}\n  ${html.content.slice(at)}` });
      }
      restored.push(violation);
    } else if (violation.kind === 'theme_key_removed') {
      const configPath = [...base.keys()].find(isTailwindConfig);
      if (!configPath) { unrepaired.push(violation); continue; }
      files.set(configPath, base.get(configPath)!);
      restored.push(violation);
    }
  }
  return { files: [...files.values()], restored, unrepaired };
}

/** The contract in words, for the top of an agent's prompt. Names and values, never the whole file. */
export function renderDesignContract(contract: DesignContract, options: { allowValueChanges?: boolean } = {}): string {
  if (!contract.tokens.length && !contract.themeKeys.length && !contract.fonts.length) return '';
  const byScope = new Map<string, TokenEntry[]>();
  for (const token of contract.tokens) byScope.set(`${token.file} ${token.stack.join(' ')}`, [...(byScope.get(`${token.file} ${token.stack.join(' ')}`) || []), token]);
  const lines = ['DESIGN CONTRACT — this project already has a design, and it lives in these files. Read it before touching any interface; the tools enforce it.'];
  let shown = 0;
  for (const [scope, tokens] of byScope) {
    if (shown >= 60) break;
    const take = tokens.slice(0, Math.max(0, 60 - shown));
    shown += take.length;
    lines.push(`- ${scope}: ${take.map(token => `${token.name}=${token.value.slice(0, 44)}`).join('; ')}${take.length < tokens.length ? '; …' : ''}`);
  }
  if (contract.themeKeys.length) {
    const sections = new Map<string, string[]>();
    for (const key of contract.themeKeys) { const [section, name] = key.split('.'); sections.set(section, [...(sections.get(section) || []), name]); }
    lines.push(`- Tailwind utilities that read those tokens (tailwind.config): ${[...sections].map(([section, names]) => `${section}: ${names.slice(0, 24).join(', ')}`).join(' | ')}`);
  }
  if (contract.fonts.length) lines.push(`- Fonts (index.html): ${contract.fonts.join(', ')}`);
  lines.push(
    'Rules for this run:',
    '1. Build with those utilities and tokens. A raw hex or rgb colour, a font that is not listed, or an arbitrary radius in a component is a design regression.',
    `2. The stylesheet, tailwind.config, the font link in index.html and the stylesheet import in the app entry are the design layer. Extend them with edit_file — add a class, add a token. Never rewrite them whole with write_file and never remove or rename a token: the tool refuses it.`,
    options.allowValueChanges
      ? '3. The user asked for a different look, so token VALUES may change — in place, keeping every name — and nothing else in the design layer moves.'
      : '3. The user did not ask for a different look: do not change a token value, a font or a radius. New screens and components belong to the existing design.',
    '4. Change what was asked and nothing else. Every other component, class and style stays exactly as it is; do not restyle, reformat or reorganise code you were not asked to touch.',
  );
  return lines.join('\n');
}
