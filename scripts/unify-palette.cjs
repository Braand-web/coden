#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * One palette for the whole product
 *
 * The composer is the reference: it paints with `--card`, `--border`,
 * `--foreground`, `--muted-foreground` and `--primary`, which all resolve to
 * the `--horizon-*` tokens. Those tokens already exist and already flip with
 * `[data-theme="dark"]`. The problem was never the palette — it was that
 * roughly eighteen hundred places in this repository wrote a hex literal
 * instead of asking for the token, so most of the product could not follow the
 * theme and had drifted into a second, darker palette of its own.
 *
 * This rewrites those literals to the token that means the same thing.
 *
 * THE SAFETY RULE IS DENY BY DEFAULT. A literal is rewritten only if it
 * appears in MAP below, under the exact property it was found on. Anything
 * else is left untouched, which is what protects the third-party brand tints
 * (React's #149eca, TypeScript's #3178c6, Supabase's #3ecf8e) that share these
 * files and must not be recoloured.
 *
 * The property is what disambiguates a literal's role. #f8fafc is the light
 * canvas when it is a background and the light-on-dark ink when it is a
 * colour, so one table keyed by hex alone would have been wrong for half its
 * uses.
 *
 * Run with --write to apply; without it, reports what it would do.
 * ------------------------------------------------------------------------- */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WRITE = process.argv.includes('--write');

/*
 * Surfaces, from the darkest backdrop to the raised panel. On the light theme
 * these are #f8fafc / #ffffff / #f1f5f9; the literals below are the dark
 * palette the landing and the Builder were hard-coded in.
 */
const CANVAS = 'var(--horizon-canvas)';
const SURFACE = 'var(--horizon-surface)';
const RAISED = 'var(--horizon-raised)';
const BORDER = 'var(--horizon-border)';
const BORDER_STRONG = 'var(--horizon-border-strong)';
const TEXT = 'var(--horizon-text)';
const MUTED = 'var(--horizon-muted)';
const SUBTLE = 'var(--horizon-subtle)';
const BLUE = 'var(--horizon-blue)';
const BLUE_HOVER = 'var(--horizon-blue-hover)';
const BLUE_INK = 'var(--horizon-blue-ink)';
const SUCCESS = 'var(--horizon-success)';
const DANGER = 'var(--horizon-danger)';
const WARNING = 'var(--horizon-warning)';

const SUCCESS_SOFT = 'var(--horizon-success-soft)';
const DANGER_SOFT = 'var(--horizon-danger-soft)';
const WARNING_SOFT = 'var(--horizon-warning-soft)';

const BACKGROUNDS = {
  // The old dark navy palette, darkest first.
  '#060606': CANVAS, '#0a0a0a': CANVAS, '#0b0e13': CANVAS, '#0d1117': CANVAS,
  '#0a0d12': CANVAS, '#0e1116': CANVAS, '#0f0f0f': CANVAS, '#0f1117': CANVAS,
  '#0f141b': CANVAS, '#14130f': CANVAS, '#000': CANVAS, '#000000': CANVAS,
  '#10151c': SURFACE, '#11161e': SURFACE, '#111': SURFACE, '#12171f': SURFACE,
  '#121a26': SURFACE, '#13151a': SURFACE, '#141922': SURFACE, '#151a22': SURFACE,
  '#161616': SURFACE, '#171716': SURFACE, '#171717': SURFACE, '#18181b': SURFACE,
  '#181818': SURFACE, '#18191e': SURFACE, '#191918': SURFACE, '#0f172a': SURFACE,
  '#1a1a1a': RAISED, '#1a212e': RAISED, '#1b2230': RAISED, '#1f1f1f': RAISED,
  '#1f2937': RAISED, '#202020': RAISED, '#20201d': RAISED, '#202a3e': RAISED,
  '#212228': RAISED, '#21242b': RAISED, '#222': RAISED, '#263244': RAISED,
  '#272727': RAISED, '#292929': RAISED, '#292a31': RAISED, '#293548': RAISED,
  '#2a2a2a': RAISED, '#2c3d57': RAISED, '#31537f': RAISED, '#16203f': RAISED,
  '#121c3d': RAISED, '#f3e8ff': RAISED,
  '#313131': BORDER_STRONG, '#3a3a3a': BORDER_STRONG, '#3a4a60': BORDER_STRONG,
  '#52525b': BORDER_STRONG, '#555555': BORDER_STRONG, '#71717a': BORDER_STRONG,
  '#9b9b9b': BORDER_STRONG,
  // The light palette and the beige it drifted into, written out by hand
  // instead of asked for.
  '#f8fafc': CANVAS, '#fffdf8': CANVAS, '#fffaf0': CANVAS,
  '#ffffff': SURFACE, '#fff': SURFACE,
  '#f1f5f9': RAISED, '#f8f3e8': RAISED, '#f8f7f3': RAISED, '#f7f7f5': RAISED,
  '#f8f8f7': RAISED, '#fafafa': RAISED, '#f4f4f5': RAISED, '#f7f8fa': RAISED,
  '#f5f7fa': RAISED, '#eef2f7': RAISED, '#f3f4f6': RAISED,
  '#e2e8f0': BORDER, '#e8e2d6': BORDER, '#cbd5e1': BORDER_STRONG,
  // Blues.
  '#4f8cff': BLUE, '#6b9bff': BLUE, '#3b82f6': BLUE, '#2563eb': BLUE,
  '#2f6df6': BLUE, '#8fb7ff': BLUE, '#526cf5': BLUE, '#566cff': BLUE,
  '#6179ff': BLUE, '#6366f1': BLUE, '#60a5fa': BLUE, '#a8c5ff': BLUE,
  '#8b5cf6': BLUE, '#93c5fd': BLUE, '#1d4ed8': BLUE_HOVER,
  // Status.
  '#36c98f': SUCCESS, '#249b6d': SUCCESS, '#22c55e': SUCCESS, '#16a34a': SUCCESS,
  '#10b981': SUCCESS, '#2fbf71': SUCCESS,
  '#dcfce7': SUCCESS_SOFT, '#f0fdf4': SUCCESS_SOFT,
  '#dc2626': DANGER, '#ef4444': DANGER, '#f87171': DANGER, '#f06b7a': DANGER,
  '#fff1f2': DANGER_SOFT,
  '#b45309': WARNING, '#fbbf24': WARNING, '#f59e0b': WARNING, '#d97706': WARNING,
  '#e7a32e': WARNING, '#f2b84b': WARNING, '#ff6b1a': WARNING, '#c4622d': WARNING,
  '#fef9c3': WARNING_SOFT, '#f1a98c': WARNING_SOFT,
};

const TEXTS = {
  /*
   * White reads as TEXT, not as the ink of a blue button.
   *
   * Both are plausible and they are opposites: `--horizon-blue-ink` is white
   * in light mode and #07111f in dark. Every white in these files sits on a
   * surface that this same pass turns into `--horizon-surface`, which is white
   * in light mode — so mapping it to the button ink would paint white on white
   * and make the text vanish. TEXT follows the surface instead. The one place
   * white genuinely is button ink, the footer CTA, is corrected by hand.
   */
  '#fff': TEXT, '#ffffff': TEXT, '#f8fafc': TEXT, '#ededed': TEXT,
  '#f4f4f5': TEXT, '#e5e7eb': TEXT, '#f3f4f6': TEXT, '#eef2f7': TEXT,
  '#f5f7fa': TEXT, '#f8f8fa': TEXT, '#f4f5f7': TEXT, '#f2f3f6': TEXT,
  '#f0f1f4': TEXT, '#f6f7f9': TEXT, '#e8e8e5': TEXT, '#f8f3e8': TEXT,
  '#f8f7f3': TEXT, '#f7f7f5': TEXT, '#fffaf0': TEXT,
  '#0f172a': TEXT, '#020617': TEXT, '#111': TEXT, '#111827': TEXT,
  '#18181b': TEXT, '#101521': TEXT, '#20201d': TEXT, '#201d17': TEXT,
  '#272622': TEXT,
  '#8d98a8': MUTED, '#aab4c3': MUTED, '#64748b': MUTED, '#71717a': MUTED,
  '#77736b': MUTED, '#8b95a5': MUTED, '#6f6a60': MUTED, '#c9c9c6': MUTED,
  '#c6c6c1': MUTED, '#aaa': MUTED, '#ccc': MUTED, '#999': MUTED,
  '#808080': MUTED, '#878787': MUTED, '#8a8a8a': MUTED, '#969696': MUTED,
  '#606060': MUTED, '#404040': MUTED, '#777777': MUTED, '#d1d1d1': MUTED,
  '#d4d4d4': MUTED, '#6b7280': MUTED, '#52525b': MUTED, '#d6dbe5': MUTED,
  '#d8dce5': MUTED, '#b8c6dc': MUTED, '#99a1b5': MUTED, '#8f96a6': MUTED,
  '#aeb4c3': MUTED, '#aeb4c2': MUTED, '#2f4056': MUTED,
  '#94a3b8': SUBTLE,
  '#8fb7ff': BLUE, '#bbd4ff': BLUE, '#4f8cff': BLUE, '#2563eb': BLUE,
  '#3b82f6': BLUE, '#2f6df6': BLUE, '#2458dc': BLUE, '#60a5fa': BLUE,
  '#93c5fd': BLUE, '#7ea5ff': BLUE, '#87b0ff': BLUE, '#8ab2ff': BLUE,
  '#91b6ff': BLUE, '#9ebeff': BLUE, '#a9c7ff': BLUE, '#a8c4ff': BLUE,
  '#b8d0ff': BLUE, '#c8dbff': BLUE, '#a78bfa': BLUE, '#6b21a8': BLUE,
  '#5b35a8': BLUE, '#1d4ed8': BLUE_HOVER,
  '#08111f': BLUE_INK,
  '#36c98f': SUCCESS, '#249b6d': SUCCESS, '#22c55e': SUCCESS, '#16a34a': SUCCESS,
  '#34d399': SUCCESS, '#4ade80': SUCCESS, '#73d69b': SUCCESS, '#a3e635': SUCCESS,
  '#80cf67': SUCCESS, '#166534': SUCCESS, '#15803d': SUCCESS, '#168457': SUCCESS,
  '#1b9c65': SUCCESS, '#11845b': SUCCESS, '#0f7a43': SUCCESS,
  '#dc2626': DANGER, '#ef4444': DANGER, '#f87171': DANGER, '#fb7185': DANGER,
  '#fca5a5': DANGER, '#f06b7a': DANGER, '#c13e4f': DANGER, '#b42318': DANGER,
  '#b3261e': DANGER, '#991b1b': DANGER, '#ff9292': DANGER, '#18080b': DANGER,
  '#b45309': WARNING, '#fbbf24': WARNING, '#d97706': WARNING, '#92400e': WARNING,
  '#854d0e': WARNING, '#b36b00': WARNING, '#e8b657': WARNING,
};

const BORDERS = {
  '#263244': BORDER, '#3a4a60': BORDER, '#1b2230': BORDER, '#2c3d57': BORDER,
  '#1f2937': BORDER, '#11161e': BORDER, '#151a22': BORDER, '#191918': BORDER,
  '#111': BORDER, '#1a1a1a': BORDER, '#222': BORDER, '#333': BORDER,
  '#444': BORDER, '#393939': BORDER, '#293548': BORDER, '#3a485c': BORDER,
  '#0f172a': BORDER, '#f8fafc': BORDER, '#e9d5ff': BORDER,
  '#e2e8f0': BORDER, '#e8e2d6': BORDER, '#f1f5f9': BORDER,
  '#cbd5e1': BORDER_STRONG, '#5a5a5a': BORDER_STRONG, '#777777': BORDER_STRONG,
  '#4f8cff': BLUE, '#3b82f6': BLUE, '#2563eb': BLUE, '#8fb7ff': BLUE,
  '#2f6df6': BLUE, '#60a5fa': BLUE, '#4f75ff': BLUE, '#566cff': BLUE,
  '#6366f1': BLUE, '#a8c5ff': BLUE, '#bfdbfe': BLUE,
  '#36c98f': SUCCESS, '#bbf7d0': SUCCESS,
  '#dc2626': DANGER, '#ef4444': DANGER, '#f87171': DANGER, '#f06b7a': DANGER,
  '#d97706': WARNING, '#fde68a': WARNING, '#c4622d': WARNING,
};

/* ---------------------------------------------------------------------------
 * The same job for `rgba()`
 *
 * A hex is opaque, so rewriting it to a token is a swap. A translucent literal
 * carries an alpha that has to survive, so it becomes a `color-mix` against
 * the token — which keeps the tint and gains the theme.
 *
 * This is not cosmetic. `color: rgba(248,250,252,.86)` is light ink meant for
 * the old dark landing; once the surface under it follows the theme, that
 * paragraph is white on white. The contrast probe caught exactly that on the
 * hero subtitle, which is how this table came to exist.
 *
 * Keyed by the RGB triplet, deny by default, same as the hex tables.
 */
const RGB_TEXTS = {
  '248,250,252': TEXT, '255,255,255': TEXT, '255,255,252': TEXT,
  '15,23,42': TEXT, '9,9,11': TEXT, '0,0,0': TEXT,
  '32,32,29': TEXT, '32,29,23': TEXT, '14,17,22': TEXT,
  '100,116,139': MUTED, '141,152,168': MUTED, '170,180,195': MUTED,
  '119,115,107': MUTED, '148,163,184': SUBTLE,
  '59,130,246': BLUE, '79,140,255': BLUE, '187,212,255': BLUE,
  '37,99,235': BLUE, '96,165,250': BLUE,
  '21,128,61': SUCCESS, '54,201,143': SUCCESS, '34,197,94': SUCCESS,
  '220,38,38': DANGER, '239,68,68': DANGER,
  '180,83,9': WARNING, '251,191,36': WARNING,
};

const RGB_BACKGROUNDS = {
  '248,250,252': CANVAS, '255,255,255': SURFACE, '255,255,252': SURFACE,
  '236,234,228': RAISED, '100,116,139': BORDER_STRONG,
  '15,23,42': SURFACE, '9,9,11': SURFACE, '0,0,0': SURFACE,
  '32,32,29': RAISED, '32,29,23': RAISED, '14,17,22': SURFACE,
  '59,130,246': BLUE, '79,140,255': BLUE, '187,212,255': BLUE,
  '37,99,235': BLUE, '96,165,250': BLUE,
  '21,128,61': SUCCESS, '54,201,143': SUCCESS, '34,197,94': SUCCESS,
  '220,38,38': DANGER, '239,68,68': DANGER,
  '180,83,9': WARNING, '251,191,36': WARNING,
};

const RGB_BORDERS = {
  '248,250,252': BORDER, '255,255,255': BORDER, '236,234,228': BORDER,
  '232,228,218': BORDER, '15,23,42': BORDER, '9,9,11': BORDER, '0,0,0': BORDER,
  '32,32,29': BORDER, '32,29,23': BORDER, '14,17,22': BORDER,
  '226,232,240': BORDER, '203,213,225': BORDER_STRONG,
  '59,130,246': BLUE, '79,140,255': BLUE, '37,99,235': BLUE, '96,165,250': BLUE,
  '220,38,38': DANGER, '54,201,143': SUCCESS, '180,83,9': WARNING,
};

const RGB_BY_PROPERTY = {
  color: RGB_TEXTS, fill: RGB_TEXTS, stroke: RGB_TEXTS,
  'caret-color': RGB_TEXTS, 'text-decoration-color': RGB_TEXTS,
  background: RGB_BACKGROUNDS, 'background-color': RGB_BACKGROUNDS,
  border: RGB_BORDERS, 'border-color': RGB_BORDERS, 'outline-color': RGB_BORDERS,
  'border-top': RGB_BORDERS, 'border-right': RGB_BORDERS,
  'border-bottom': RGB_BORDERS, 'border-left': RGB_BORDERS,
  'border-top-color': RGB_BORDERS, 'border-right-color': RGB_BORDERS,
  'border-bottom-color': RGB_BORDERS, 'border-left-color': RGB_BORDERS,
};

/* Which table applies to which property. */
const BY_PROPERTY = {
  color: TEXTS, fill: TEXTS, stroke: TEXTS,
  'caret-color': TEXTS, 'text-decoration-color': TEXTS,
  background: BACKGROUNDS, 'background-color': BACKGROUNDS,
  border: BORDERS, 'border-color': BORDERS, 'outline-color': BORDERS,
  'border-top': BORDERS, 'border-right': BORDERS,
  'border-bottom': BORDERS, 'border-left': BORDERS,
  'border-top-color': BORDERS, 'border-right-color': BORDERS,
  'border-bottom-color': BORDERS, 'border-left-color': BORDERS,
};

/*
 * Coden's own chrome only.
 *
 * `builder-live.ts` is excluded although it holds 108 literals: six of the
 * strings in it are complete HTML documents rendered into a sandboxed frame as
 * a preview of the CUSTOMER's app. Those are not Coden's surfaces and must
 * keep the colours they were generated with — recolouring them would change
 * what people's own applications look like.
 *
 * The horizon system and the design system are excluded for the opposite
 * reason: their literals ARE the token definitions. Rewriting a definition to
 * point at itself is how a palette becomes a circular reference that resolves
 * to nothing.
 */
const INCLUDE = [
  'index.html', 'builder.html', 'dashboard.html', 'admin.html', 'auth.html',
  'pricing.html', 'features.html', 'documentation.html', 'security.html',
  'privacy.html', 'terms.html',
  'src/settings-panel.ts', 'src/connectors-panel.ts',
  'src/builder-conversation-island.tsx', 'src/ai-chat-input-normalizer.ts',
  'src/model-selector-ui.ts', 'src/prompt-input-actions.ts',
];

const EXCLUDE_CSS = new Set([
  'src/styles/coden-horizon-system.css',
  'src/styles/coden-tailwind.css',
  'src/design-system.css',
]);

function cssFiles() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.css')) {
        const rel = path.relative(ROOT, full);
        if (!EXCLUDE_CSS.has(rel)) out.push(rel);
      }
    }
  })(path.join(ROOT, 'src'));
  return out;
}

const PROPERTY_NAMES = Object.keys(BY_PROPERTY).sort((a, b) => b.length - a.length).join('|');

let totalChanged = 0;
const perFile = [];
const untouched = new Map();

for (const rel of [...INCLUDE, ...cssFiles()]) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) continue;
  const before = fs.readFileSync(full, 'utf8');
  let changed = 0;

  /*
   * Comments are left alone.
   *
   * Several of them quote the literal they exist to explain — the note in
   * coden-composer.css describing the landing host's inline
   * `border:1px solid #263244; background:#151a22` is the reason that host is
   * neutralised at all. Rewriting those to token names turns an explanation of
   * what was wrong into a description of something that never happened.
   */
  const transform = (source) => source.replace(
    /*
     * The value runs to the end of the declaration, parentheses included.
     * Stopping at the first `)` truncated every `rgba(...)` before its closing
     * paren, so the translucent literals — the ones that actually go invisible
     * when the surface under them starts following the theme — were never even
     * seen by this pass.
     */
    new RegExp(`(^|[;{,"'\\s])(${PROPERTY_NAMES})(\\s*:\\s*)([^;"'}\\n]*)`, 'g'),
    (match, lead, prop, sep, value) => {
      /*
       * A custom property declaration is a definition, not a use. `--bg: #fff`
       * happens to end in `bg: #fff` and would otherwise be matched as the
       * `background` shorthand and rewritten to point at a token — which is
       * how a palette turns into a circular reference.
       */
      if (lead === '-' || /-$/.test(lead)) return match;
      const table = BY_PROPERTY[prop];
      const rgbTable = RGB_BY_PROPERTY[prop];

      let next = value.replace(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)/g,
        (whole, r, g, b, alpha) => {
          const token = rgbTable[`${+r},${+g},${+b}`];
          if (!token) {
            untouched.set(`${prop} | ${whole.replace(/\s+/g, '')}`, (untouched.get(`${prop} | ${whole.replace(/\s+/g, '')}`) || 0) + 1);
            return whole;
          }
          changed += 1;
          if (alpha === undefined) return token;
          const percent = alpha.endsWith('%') ? parseFloat(alpha) : parseFloat(alpha) * 100;
          if (!Number.isFinite(percent)) return whole;
          // Opaque anyway: a color-mix at 100% is just noise.
          if (percent >= 99.5) return token;
          return `color-mix(in srgb, ${token} ${Math.round(percent * 100) / 100}%, transparent)`;
        });

      next = next.replace(/#[0-9a-fA-F]{3,8}\b/g, hex => {
        const token = table[hex.toLowerCase()];
        if (!token) {
          const key = `${prop} | ${hex.toLowerCase()}`;
          untouched.set(key, (untouched.get(key) || 0) + 1);
          return hex;
        }
        changed += 1;
        return token;
      });
      return lead + prop + sep + next;
    },
  );

  // Split on block and line comments, transform only the code between them.
  const after = before
    .split(/(\/\*[\s\S]*?\*\/|^[ \t]*\/\/.*$)/m)
    .map((segment, index) => (index % 2 === 1 ? segment : transform(segment)))
    .join('');

  if (changed) {
    totalChanged += changed;
    perFile.push([rel, changed]);
    if (WRITE) fs.writeFileSync(full, after);
  }
}

perFile.sort((a, b) => b[1] - a[1]);
console.log(`${WRITE ? 'Réécrit' : 'Réécrirait'} ${totalChanged} littéraux dans ${perFile.length} fichiers :`);
for (const [rel, n] of perFile) console.log('  ' + String(n).padStart(4) + '  ' + rel);

const left = [...untouched.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\nLaissés en place (hors table, donc délibérément intacts) : ${left.reduce((a, r) => a + r[1], 0)}`);
for (const [key, n] of left) console.log('  ' + String(n).padStart(4) + '  ' + key);
