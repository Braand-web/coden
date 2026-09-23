/**
 * A concrete visual identity for each generated project.
 *
 * The design policy already chooses a direction, a typography pair and a
 * palette character per project — as sentences in the prompt. The scaffold
 * then shipped one fixed stylesheet: the same cool blue accent, the same dark
 * surfaces and the system font for every application. A model asked to build
 * "a warm bakery site" started from a devtool palette and, more often than
 * not, kept it. Every generated app looked like every other one.
 *
 * This turns the same decisions into files: the token layer in
 * `src/index.css` and the font link in `index.html` are written for this
 * project before the model writes a line. The model can still change them —
 * neither is reserved — but the default it starts from is already specific to
 * the product, and stable for the project (seeded by its id), so a repair
 * round never repaints it.
 *
 * Every value is chosen from ranges that hold up: neutrals stay low-chroma,
 * the accent keeps a readable contrast against both surfaces, and the
 * semantic colours share the accent's lightness so nothing shouts louder than
 * the primary action.
 */

import {
  buildGeneratedDesignDna,
  chooseDesignDirection,
  classifyGeneratedAppType,
  type DesignDirection,
} from '../design-generation-policy.ts';

type Mode = 'light' | 'dark';

type FontSpec = { family: string; weights: string; fallback: 'sans' | 'serif' | 'mono' };

export type ProjectTheme = {
  direction: DesignDirection;
  mode: Mode;
  hue: number;
  body: FontSpec | null;
  display: FontSpec | null;
  radius: { control: number; card: number; modal: number };
  motion: { micro: number; state: number; ease: string };
  /** One line per decision, for the prompt: what the scaffold already chose. */
  summary: string;
};

/*
 * Only families whose weights are verified against the Google Fonts css2 API:
 * a weight a family does not have fails the whole stylesheet request, and the
 * app silently falls back to the system font.
 */
const FONTS: Record<string, FontSpec> = {
  Manrope: { family: 'Manrope', weights: '400;500;600;700', fallback: 'sans' },
  Fraunces: { family: 'Fraunces', weights: '400;600;700', fallback: 'serif' },
  'IBM Plex Sans': { family: 'IBM Plex Sans', weights: '400;500;600;700', fallback: 'sans' },
  'IBM Plex Serif': { family: 'IBM Plex Serif', weights: '400;600', fallback: 'serif' },
  'DM Sans': { family: 'DM Sans', weights: '400;500;600;700', fallback: 'sans' },
  Newsreader: { family: 'Newsreader', weights: '400;600', fallback: 'serif' },
  Geist: { family: 'Geist', weights: '400;500;600;700', fallback: 'sans' },
  'Instrument Serif': { family: 'Instrument Serif', weights: '', fallback: 'serif' },
  'Source Sans 3': { family: 'Source Sans 3', weights: '400;600;700', fallback: 'sans' },
  'Source Serif 4': { family: 'Source Serif 4', weights: '400;600', fallback: 'serif' },
  'Space Grotesk': { family: 'Space Grotesk', weights: '400;500;600;700', fallback: 'sans' },
  Lora: { family: 'Lora', weights: '400;600', fallback: 'serif' },
  'Public Sans': { family: 'Public Sans', weights: '400;500;600;700', fallback: 'sans' },
  'Libre Baskerville': { family: 'Libre Baskerville', weights: '400;700', fallback: 'serif' },
  'JetBrains Mono': { family: 'JetBrains Mono', weights: '400;500', fallback: 'mono' },
};

/*
 * Per direction: the default mode, the hues that suit it, and how saturated
 * its accent may be. The project seed picks one hue from the list, so two
 * dashboards differ while both still read as dashboards.
 */
const DIRECTIONS: Record<DesignDirection, { mode: Mode; hues: number[]; chroma: number; neutral: number; radius: [number, number, number] }> = {
  cinematic_landing: { mode: 'dark', hues: [265, 290, 200, 25, 160], chroma: 0.17, neutral: 0.012, radius: [10, 18, 24] },
  dense_devtool: { mode: 'dark', hues: [250, 200, 150, 280], chroma: 0.14, neutral: 0.010, radius: [6, 10, 14] },
  data_operational: { mode: 'light', hues: [250, 220, 175, 265], chroma: 0.14, neutral: 0.008, radius: [6, 10, 14] },
  commerce_trust: { mode: 'light', hues: [30, 250, 150, 340], chroma: 0.15, neutral: 0.006, radius: [10, 14, 20] },
  hospitality_warm: { mode: 'light', hues: [45, 30, 70, 140], chroma: 0.13, neutral: 0.014, radius: [12, 18, 24] },
  editorial_portfolio: { mode: 'light', hues: [25, 60, 250, 0], chroma: 0.12, neutral: 0.010, radius: [4, 8, 12] },
  luxury_minimal: { mode: 'dark', hues: [80, 60, 300, 20], chroma: 0.09, neutral: 0.008, radius: [2, 6, 10] },
  playful_consumer: { mode: 'light', hues: [330, 290, 160, 50], chroma: 0.19, neutral: 0.014, radius: [14, 22, 28] },
  warm_saas: { mode: 'light', hues: [270, 25, 180, 250], chroma: 0.15, neutral: 0.010, radius: [10, 14, 20] },
  mobile_product: { mode: 'light', hues: [250, 155, 300, 20], chroma: 0.16, neutral: 0.010, radius: [14, 20, 26] },
  regulated_trust: { mode: 'light', hues: [235, 200, 160], chroma: 0.12, neutral: 0.008, radius: [6, 10, 14] },
  immersive_creative: { mode: 'dark', hues: [300, 330, 190, 60], chroma: 0.19, neutral: 0.016, radius: [12, 20, 28] },
};

const MOTION = [
  { micro: 150, state: 220, ease: 'cubic-bezier(0.2, 0, 0, 1)' },
  { micro: 140, state: 260, ease: 'cubic-bezier(0.32, 0.72, 0, 1)' },
  { micro: 120, state: 200, ease: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  { micro: 180, state: 320, ease: 'cubic-bezier(0.16, 1, 0.3, 1)' },
];

function hash(value: string): number {
  let h = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function fontsFromPair(pair: string): { body: FontSpec | null; display: FontSpec | null } {
  const match = /^(.+?) for interface text \+ (.+?) for /.exec(pair);
  if (!match) return { body: null, display: FONTS['JetBrains Mono'] };
  return { body: FONTS[match[1].trim()] || null, display: FONTS[match[2].trim()] || null };
}

export function buildProjectTheme(input: { prompt: string; seed?: string }): ProjectTheme {
  const appType = classifyGeneratedAppType(input.prompt);
  const direction = chooseDesignDirection(appType, input.prompt);
  const dna = buildGeneratedDesignDna({ prompt: input.prompt, appType, designDirection: direction, seed: input.seed });
  const spec = DIRECTIONS[direction] || DIRECTIONS.warm_saas;
  const h = hash(`${input.seed || ''}|${direction}|${input.prompt.trim().toLowerCase()}`);
  const text = input.prompt.toLowerCase();
  // The user's own words about the look outrank the direction's default.
  const mode: Mode = /\b(dark|sombre|nuit|night|noir)\b/.test(text) ? 'dark'
    : /\b(light|clair|blanc|white|lumineux)\b/.test(text) ? 'light'
      : spec.mode;
  const hue = spec.hues[h % spec.hues.length];
  const { body, display } = fontsFromPair(dna.typographyPair);
  const [control, card, modal] = spec.radius;
  const motion = MOTION[(h >>> 5) % MOTION.length];
  const fontLine = body || display
    ? `${body?.family || 'system sans'} for text, ${display?.family || body?.family || 'system sans'} for display headings`
    : 'system sans';
  return {
    direction,
    mode,
    hue,
    body,
    display,
    radius: { control, card, modal },
    motion,
    summary: [
      `Visual identity already applied in src/index.css and index.html (extend it; change it only if the user asks for a different look):`,
      `- Direction: ${direction.replace(/_/g, ' ')}; default ${mode} mode with a complete ${mode === 'dark' ? 'light' : 'dark'} theme under [data-theme].`,
      `- Accent hue ${hue} (OKLCH), low-chroma neutrals tinted toward it. Use the semantic Tailwind colours (bg, surface, content, secondary, accent…), never raw hex.`,
      `- Typography: ${fontLine}. Tailwind: font-sans for text, font-display for headings.`,
      `- Radii: control ${control}px, card ${card}px, modal ${modal}px (rounded-control / rounded-card / rounded-modal).`,
      `- Motion: ${motion.micro}ms micro, ${motion.state}ms state, easing ${motion.ease} (duration-micro / duration-state / ease-standard). Signature: ${dna.motionSignature}.`,
    ].join('\n'),
  };
}

const r = (value: number) => Math.round(value * 1000) / 1000;

function palette(mode: Mode, hue: number, chroma: number, neutral: number): string {
  const n = (l: number, c = neutral) => `oklch(${r(l)} ${r(c)} ${hue})`;
  const accent = (l: number) => `oklch(${r(l)} ${r(chroma)} ${hue})`;
  const state = (l: number, stateHue: number) => `oklch(${r(l)} 0.15 ${stateHue})`;
  if (mode === 'dark') {
    return [
      '  color-scheme: dark;',
      `  --color-bg: ${n(0.16)};`,
      `  --color-surface: ${n(0.2)};`,
      `  --color-surface-raised: ${n(0.24, neutral * 1.2)};`,
      `  --color-border: ${n(0.31, neutral * 1.4)};`,
      `  --color-border-subtle: ${n(0.26, neutral * 1.2)};`,
      `  --color-text: ${n(0.96, neutral * 0.5)};`,
      `  --color-text-secondary: ${n(0.76, neutral)};`,
      `  --color-text-tertiary: ${n(0.6, neutral)};`,
      `  --color-accent: ${accent(0.7)};`,
      `  --color-accent-hover: ${accent(0.76)};`,
      `  --color-accent-soft: oklch(${r(0.7)} ${r(chroma)} ${hue} / 0.16);`,
      `  --color-on-accent: ${n(0.15)};`,
      `  --color-success: ${state(0.7, 150)};`,
      `  --color-warning: ${state(0.76, 75)};`,
      `  --color-error: ${state(0.68, 25)};`,
      `  --color-info: ${state(0.7, 230)};`,
      '  --shadow-card: 0 1px 2px oklch(0 0 0 / 0.30), 0 8px 24px oklch(0 0 0 / 0.20);',
      '  --shadow-card-hover: 0 2px 4px oklch(0 0 0 / 0.32), 0 16px 40px oklch(0 0 0 / 0.26);',
    ].join('\n');
  }
  return [
    '  color-scheme: light;',
    `  --color-bg: ${n(0.985, neutral * 0.6)};`,
    `  --color-surface: ${n(0.998, neutral * 0.3)};`,
    `  --color-surface-raised: ${n(0.965, neutral * 0.8)};`,
    `  --color-border: ${n(0.9, neutral)};`,
    `  --color-border-subtle: ${n(0.94, neutral * 0.8)};`,
    `  --color-text: ${n(0.22, neutral * 1.2)};`,
    `  --color-text-secondary: ${n(0.45, neutral * 1.2)};`,
    `  --color-text-tertiary: ${n(0.6, neutral)};`,
    `  --color-accent: ${accent(0.53)};`,
    `  --color-accent-hover: ${accent(0.47)};`,
    `  --color-accent-soft: oklch(${r(0.53)} ${r(chroma)} ${hue} / 0.10);`,
    `  --color-on-accent: ${n(0.99, 0.004)};`,
    `  --color-success: ${state(0.52, 150)};`,
    `  --color-warning: ${state(0.6, 70)};`,
    `  --color-error: ${state(0.52, 25)};`,
    `  --color-info: ${state(0.52, 230)};`,
    '  --shadow-card: 0 1px 2px oklch(0.2 0.02 250 / 0.06), 0 6px 20px oklch(0.2 0.02 250 / 0.07);',
    '  --shadow-card-hover: 0 2px 6px oklch(0.2 0.02 250 / 0.08), 0 16px 36px oklch(0.2 0.02 250 / 0.12);',
  ].join('\n');
}

const STACKS = {
  sans: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
};
const stack = (font: FontSpec | null, fallback: keyof typeof STACKS) =>
  font ? `"${font.family}", ${STACKS[font.fallback]}` : STACKS[fallback];

/** The token layer for `src/index.css`, written for this project. */
export function renderThemeCss(theme: ProjectTheme): string {
  const spec = DIRECTIONS[theme.direction] || DIRECTIONS.warm_saas;
  const other: Mode = theme.mode === 'dark' ? 'light' : 'dark';
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

/*
 * This project's identity: ${theme.direction.replace(/_/g, ' ')}, accent hue ${theme.hue}.
 * Neutrals carry a trace of the accent hue and never reach pure white or
 * black. Components use the semantic tokens, so the whole theme changes here.
 */
:root {
${palette(theme.mode, theme.hue, spec.chroma, spec.neutral)}

  --font-body: ${stack(theme.body, 'sans')};
  --font-display: ${stack(theme.display || theme.body, 'sans')};
  --font-mono: ${STACKS.mono};

  --radius-control: ${theme.radius.control}px;
  --radius-card: ${theme.radius.card}px;
  --radius-modal: ${theme.radius.modal}px;

  --ease-standard: ${theme.motion.ease};
  --duration-micro: ${theme.motion.micro}ms;
  --duration-state: ${theme.motion.state}ms;
}

:root[data-theme="${theme.mode}"] {
${palette(theme.mode, theme.hue, spec.chroma, spec.neutral)}
}

/* The other mode is rebuilt with the same logic, not inverted. */
:root[data-theme="${other}"] {
${palette(other, theme.hue, spec.chroma, spec.neutral)}
}

html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }

body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

h1, h2, h3 { font-family: var(--font-display); letter-spacing: -0.015em; line-height: 1.15; text-wrap: balance; }
p { text-wrap: pretty; }
img, svg, video { max-width: 100%; }
::selection { background: var(--color-accent-soft); }

:where(button, input, select, textarea) { min-height: 44px; font: inherit; }
:where(button, [role="button"], select, summary) { cursor: pointer; }
:where(button, input, select, textarea):disabled { cursor: not-allowed; }

/* Focus is never removed, only restyled. */
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* Motion is opt-out for anyone who has asked the OS to reduce it. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;
}

/** `index.html` with this project's fonts preconnected and loaded. */
export function renderThemeIndexHtml(theme: ProjectTheme, title = 'App'): string {
  const families = [theme.body, theme.display].filter((font, index, all): font is FontSpec =>
    Boolean(font) && all.findIndex(other => other?.family === font!.family) === index);
  const query = families
    .map(font => `family=${font.family.replace(/ /g, '+')}${font.weights ? `:wght@${font.weights}` : ''}`)
    .join('&');
  const fontTags = query
    ? `
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${query}&display=swap" />`
    : '';
  const safeTitle = String(title || 'App').replace(/[<>&"]/g, '').slice(0, 80) || 'App';
  return `<!doctype html>
<html lang="en" data-theme="${theme.mode}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="${theme.mode === 'dark' ? '#111318' : '#fbfbfc'}" />
    <title>${safeTitle}</title>${fontTags}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}
