/**
 * The parts of an application nobody should pay a language model to write.
 *
 * A React project's package.json, its Vite config, its entry point, its
 * Tailwind setup, its error boundary — these are the same every time. Having
 * the model emit them costs tokens, costs latency, and costs correctness: it
 * is the boilerplate, not the business logic, that arrives with a wrong Vite
 * version or an entry point that does not match the index.html.
 *
 * So the scaffold is a fixture and the model writes the application. What it
 * gets is a project that already installs, already builds and already renders
 * — which also means the first preview can come up before a single generated
 * file exists.
 *
 * Deliberately small. A starter that ships twenty components the app does not
 * use is a starter the model has to read around, and every unused dependency
 * is install time paid on every project.
 */

import type { SandboxFile } from './project-sandbox.ts';

export type StarterId = 'react-vite' | 'react-supabase';

export type Starter = {
  id: StarterId;
  title: string;
  description: string;
  /** What the model must not rewrite, because the scaffold owns it. */
  reservedPaths: readonly string[];
  /**
   * The one file the scaffold ships as a placeholder for the model to replace.
   *
   * It is what `src/main.tsx` renders, so until it is replaced the running
   * application is the scaffold saying "Building…" — whatever else was written
   * alongside it. Naming it here lets verification check that claim instead of
   * trusting it.
   */
  entryPath: string;
  files: readonly SandboxFile[];
};

/**
 * Pinned, not floating.
 *
 * A caret range means the scaffold installs a different tree next week than it
 * does today, and the first anyone hears of it is a generated app that no
 * longer builds. This is a fixture; fixtures do not drift.
 */
const VERSIONS = {
  react: '18.3.1',
  reactDom: '18.3.1',
  vite: '6.2.0',
  pluginReact: '4.3.4',
  tailwind: '3.4.17',
  autoprefixer: '10.4.20',
  postcss: '8.4.49',
  supabase: '2.47.10',
  typesReact: '18.3.18',
  typesReactDom: '18.3.5',
} as const;

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    jsx: 'react-jsx',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
    isolatedModules: true,
    baseUrl: '.',
    paths: { '@/*': ['src/*'] },
  },
  include: ['src'],
}, null, 2);

const VITE_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // '@/components/Button' resolves the same way in the editor, the dev
    // server and the production build. Without this the three disagree.
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
});
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const MAIN_TSX = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
`;

/**
 * The error boundary is in the scaffold rather than left to the model because
 * of what it does for the preview: without one, a single component throwing
 * unmounts the whole tree and the iframe goes white with the reason only in
 * the console. With one, the failure is on screen and legible.
 */
const ERROR_BOUNDARY = `import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app] render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-6">
        <div className="w-full max-w-lg rounded-card border border-border bg-surface p-6 shadow-card">
          <h1 className="text-base font-semibold text-error">This screen failed to render</h1>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-relaxed text-secondary">
            {this.state.error.message}
          </pre>
        </div>
      </div>
    );
  }
}
`;

/**
 * The token layer every generated project starts with.
 *
 * Written to the design contract in src/lib/prompts/generated-app-design.ts so
 * a project is compliant before the model writes a line: tinted neutrals in
 * OKLCH with chroma at or below 0.02, one accent, semantic states sharing the
 * accent's lightness and chroma so only hue distinguishes them, and a radius
 * scale keyed by component category.
 *
 * It also means a fresh project passes the design audit's token checks. A
 * scaffold with no tokens hands every generated app two failed checks it did
 * nothing to earn, and a repair pass chasing them.
 */
const INDEX_CSS = `@tailwind base;
@tailwind components;
@tailwind utilities;

/*
 * Neutrals carry a trace of hue (250, cool) rather than being achromatic, and
 * never reach pure white or black — a pure #FFF surface next to a pure #000
 * text reads as harsh on a screen and leaves no room for elevation.
 */
:root {
  color-scheme: dark;

  --color-bg: oklch(0.16 0.008 250);
  --color-surface: oklch(0.20 0.008 250);
  --color-surface-raised: oklch(0.24 0.010 250);
  --color-border: oklch(0.30 0.012 250);
  --color-border-subtle: oklch(0.25 0.010 250);

  --color-text: oklch(0.96 0.004 250);
  --color-text-secondary: oklch(0.74 0.008 250);
  --color-text-tertiary: oklch(0.56 0.010 250);

  /* One accent. Semantic states share its lightness and chroma; only hue moves,
     so nothing shouts louder than anything else. */
  --color-accent: oklch(0.62 0.15 250);
  --color-accent-hover: oklch(0.68 0.15 250);
  --color-on-accent: oklch(0.16 0.008 250);

  --color-success: oklch(0.62 0.15 150);
  --color-warning: oklch(0.62 0.15 75);
  --color-error: oklch(0.62 0.15 25);
  --color-info: oklch(0.62 0.15 230);

  /* Radii by component category, not by whim. */
  --radius-control: 8px;
  --radius-card: 14px;
  --radius-modal: 18px;

  --shadow-card: 0 1px 2px oklch(0 0 0 / 0.20), 0 4px 12px oklch(0 0 0 / 0.12);
  --shadow-card-hover: 0 2px 4px oklch(0 0 0 / 0.22), 0 8px 24px oklch(0 0 0 / 0.16);

  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-micro: 150ms;
  --duration-state: 250ms;
}

/* The light palette is rebuilt with the same logic, not inverted. */
:root[data-theme="light"] {
  color-scheme: light;

  --color-bg: oklch(0.98 0.004 250);
  --color-surface: oklch(0.995 0.002 250);
  --color-surface-raised: oklch(0.965 0.005 250);
  --color-border: oklch(0.90 0.008 250);
  --color-border-subtle: oklch(0.94 0.006 250);

  --color-text: oklch(0.22 0.010 250);
  --color-text-secondary: oklch(0.46 0.012 250);
  --color-text-tertiary: oklch(0.62 0.010 250);

  --color-accent: oklch(0.52 0.15 250);
  --color-accent-hover: oklch(0.46 0.15 250);
  --color-on-accent: oklch(0.99 0.002 250);

  --color-success: oklch(0.52 0.15 150);
  --color-warning: oklch(0.52 0.15 75);
  --color-error: oklch(0.52 0.15 25);
  --color-info: oklch(0.52 0.15 230);
}

body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: Inter, ui-sans-serif, -apple-system, "Segoe UI", "Helvetica Neue", sans-serif;
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* Focus is never removed, only restyled — the contract makes it non-negotiable. */
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

const TAILWIND_CONFIG = `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['class', '[data-theme="light"]'],
  theme: {
    extend: {
      // The tokens, reachable as utilities: bg-surface, text-secondary,
      // border-border. Components never name a raw colour, so the theme is
      // changed in one place and dark mode follows for free.
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-raised': 'var(--color-surface-raised)',
        border: 'var(--color-border)',
        'border-subtle': 'var(--color-border-subtle)',
        content: 'var(--color-text)',
        secondary: 'var(--color-text-secondary)',
        tertiary: 'var(--color-text-tertiary)',
        accent: 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        'on-accent': 'var(--color-on-accent)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        error: 'var(--color-error)',
        info: 'var(--color-info)',
      },
      // A bare "border" utility should use the token, not Tailwind's reset
      // grey. Making the token the default means a component has to opt out of
      // the theme rather than remember to opt in.
      borderColor: { DEFAULT: 'var(--color-border)' },
      borderRadius: {
        control: 'var(--radius-control)',
        card: 'var(--radius-card)',
        modal: 'var(--radius-modal)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
      },
      transitionTimingFunction: { standard: 'var(--ease-standard)' },
      transitionDuration: { micro: '150ms', state: '250ms' },
      // Tailwind's default spacing scale is already the contract's:
      // 1=4px, 2=8, 3=12, 4=16, 6=24, 8=32, 12=48, 16=64.
      maxWidth: { prose: '72ch', container: '1280px' },
    },
  },
  plugins: [],
};
`;

const POSTCSS_CONFIG = `export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
`;

const APP_PLACEHOLDER = `export default function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg">
      <p className="text-sm text-tertiary">Building…</p>
    </main>
  );
}
`;

function packageJson(name: string, extraDependencies: Record<string, string> = {}): string {
  return JSON.stringify({
    name,
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
      typecheck: 'tsc --noEmit',
    },
    dependencies: {
      react: VERSIONS.react,
      'react-dom': VERSIONS.reactDom,
      ...extraDependencies,
    },
    devDependencies: {
      // Without these `npm run typecheck` fails on the scaffold itself, with
      // TS7016 on every React import and TS7026 on every JSX element -- so
      // every generated project would start with a broken check and the first
      // repair attempt would chase an error the model did not cause.
      '@types/react': VERSIONS.typesReact,
      '@types/react-dom': VERSIONS.typesReactDom,
      '@vitejs/plugin-react': VERSIONS.pluginReact,
      autoprefixer: VERSIONS.autoprefixer,
      postcss: VERSIONS.postcss,
      tailwindcss: VERSIONS.tailwind,
      typescript: '5.7.3',
      vite: VERSIONS.vite,
    },
  }, null, 2) + '\n';
}

const BASE_FILES: SandboxFile[] = [
  { path: 'index.html', content: INDEX_HTML },
  { path: 'vite.config.ts', content: VITE_CONFIG },
  { path: 'tsconfig.json', content: TSCONFIG },
  { path: 'tailwind.config.js', content: TAILWIND_CONFIG },
  { path: 'postcss.config.js', content: POSTCSS_CONFIG },
  { path: 'src/main.tsx', content: MAIN_TSX },
  { path: 'src/index.css', content: INDEX_CSS },
  { path: 'src/components/ErrorBoundary.tsx', content: ERROR_BOUNDARY },
  { path: 'src/App.tsx', content: APP_PLACEHOLDER },
];

/**
 * The paths the scaffold owns.
 *
 * `src/App.tsx` is not among them: it is the placeholder the model is meant to
 * replace, and the first thing it will.
 */
const RESERVED = [
  'package.json', 'vite.config.ts', 'tsconfig.json',
  'tailwind.config.js', 'postcss.config.js',
  'src/main.tsx', 'src/components/ErrorBoundary.tsx',
] as const;

const SUPABASE_CLIENT = `import { createClient } from '@supabase/supabase-js';

// Public, per-project configuration. The anon key is safe in a browser
// bundle; the service role key never is, and never appears here.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('[app] Supabase is not configured yet — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

export const supabase = createClient(url ?? '', anonKey ?? '');
`;

const ENV_TYPES = `/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
`;

export const STARTERS: Record<StarterId, Starter> = {
  'react-vite': {
    id: 'react-vite',
    title: 'React + Vite + Tailwind',
    description: 'A typed React application with Tailwind, an error boundary and a typecheck script.',
    reservedPaths: RESERVED,
    entryPath: 'src/App.tsx',
    files: [{ path: 'package.json', content: packageJson('app') }, ...BASE_FILES, { path: 'src/vite-env.d.ts', content: '/// <reference types="vite/client" />\n' }],
  },
  'react-supabase': {
    id: 'react-supabase',
    title: 'React + Vite + Tailwind + Supabase',
    description: 'The React starter with a configured Supabase browser client and typed environment.',
    reservedPaths: [...RESERVED, 'src/lib/supabase.ts'],
    entryPath: 'src/App.tsx',
    files: [
      { path: 'package.json', content: packageJson('app', { '@supabase/supabase-js': VERSIONS.supabase }) },
      ...BASE_FILES,
      { path: 'src/lib/supabase.ts', content: SUPABASE_CLIENT },
      { path: 'src/vite-env.d.ts', content: ENV_TYPES },
    ],
  },
};

/** The placeholder body, so a caller can tell "untouched" from "rewritten". */
export const STARTER_ENTRY_PLACEHOLDER = APP_PLACEHOLDER;

/**
 * Is this project still the scaffold, whatever else it contains?
 *
 * Production said yes for eleven of the last twelve generations, seven of
 * which were nevertheless recorded as `verified`: the coder wrote its own
 * files — `src/calculator.js`, `src/style.css`, `src/main.js` — and left
 * `src/App.tsx` at its 194-byte placeholder, so `index.html` → `src/main.tsx`
 * → `App` still rendered "Building…" and nothing the model wrote was ever
 * loaded. That is the preview that never fills in.
 */
export function isStarterEntryUntouched(files: readonly { path: string; content?: string }[], starter: Starter): boolean {
  const normalize = (path: string) => path.replace(/^\.\//, '').replace(/\\/g, '/');
  const entry = files.find(file => normalize(file.path) === starter.entryPath);
  if (!entry) return false;
  return String(entry.content || '').trim() === STARTER_ENTRY_PLACEHOLDER.trim();
}

/**
 * Which scaffold a prompt asks for.
 *
 * Only one question is asked -- does this need a backend -- because that is
 * the only one whose answer changes the scaffold. Guessing more from a prompt
 * produces confident wrong choices, and the model can add anything else it
 * needs as a dependency.
 */
export function selectStarter(prompt: string): Starter {
  const text = String(prompt || '').toLowerCase();
  const needsBackend = /\b(auth|authentification|login|connexion|sign\s?up|inscription|database|base de donn|supabase|postgres|sql|crud|utilisateurs?|users?|compte|account|dashboard admin|multi[- ]?tenant|abonnement|subscription|stripe|realtime|storage)\b/.test(text);
  return needsBackend ? STARTERS['react-supabase'] : STARTERS['react-vite'];
}

/**
 * Merge generated files over a scaffold.
 *
 * The scaffold's own files lose to nothing except themselves: a model that
 * decides to rewrite package.json with a different Vite version, or to replace
 * the entry point with one that does not match index.html, breaks a project
 * that worked — and does it silently, because the failure surfaces as a blank
 * preview rather than a rejected write. Those paths are protected; everything
 * else the model sends wins, including src/App.tsx, which is the placeholder
 * it is meant to replace.
 */
export function applyStarter(starter: Starter, generated: readonly SandboxFile[]): {
  files: SandboxFile[];
  rejected: string[];
} {
  const reserved = new Set(starter.reservedPaths.map(path => path.replace(/^\.\//, '')));
  const merged = new Map<string, SandboxFile>();
  for (const file of starter.files) merged.set(file.path, file);

  const rejected: string[] = [];
  for (const file of generated || []) {
    if (!file || typeof file.path !== 'string') continue;
    const path = file.path.replace(/^\.\//, '').replace(/\\/g, '/');
    if (reserved.has(path)) {
      rejected.push(path);
      continue;
    }
    merged.set(path, { path, content: typeof file.content === 'string' ? file.content : '' });
  }
  return { files: [...merged.values()], rejected };
}

/**
 * The scaffold, described for a prompt.
 *
 * Sent instead of the scaffold's contents: the model needs to know what
 * already exists and what it must not rewrite, not to read three hundred
 * lines of configuration it will never change.
 */
export function describeStarter(starter: Starter): string {
  return [
    `Scaffold: ${starter.title}.`,
    'These files already exist and must not be rewritten:',
    ...starter.reservedPaths.map(path => `- ${path}`),
    'Tailwind, TypeScript and an error boundary are already configured.',
    "Import application code with the '@/' alias, which points at src/.",
    `index.html loads src/main.tsx, which renders ${starter.entryPath}. ${starter.entryPath} currently holds a placeholder that renders "Building…"; replacing it is what makes the application appear.`,
    `Write the application itself in ${starter.entryPath} and in the components, pages, hooks and state it imports. A file ${starter.entryPath} does not import is never loaded, whatever it contains.`,
    'This is a React + TypeScript project. Write .tsx/.ts, not standalone .js entry points.',
  ].join('\n');
}
