import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CODEN_PREVIEW_RENDERER_VERSION, collectPreviewStyles, scriptSafeJson, styleSafeCss, tailwindConfigScript } from './preview-embedding.ts';

type TestFile = { path: string; content: string };
const file = (path: string, content: string): TestFile => ({ path, content });
const files = [
  file('index.html', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">'),
  file('src/main.tsx', "import App from './App';\nimport './index.css';"),
  file('src/App.tsx', "import Hero from './components/Hero';\nexport default function App(){return <Hero/>}"),
  file('src/components/Hero.tsx', "import './Hero.css';\nexport default function Hero(){return <main className='hero'>Hello</main>}"),
  file('src/index.css', 'body { margin: 0; }'),
  file('src/components/Hero.css', '@import "../tokens.css";\n.hero { display: grid; }'),
  file('src/tokens.css', ':root { --ink: #123; }'),
  file('src/unused.css', '.hero { display: none; }'),
];

const source = ts.createSourceFile('server.ts', readFileSync(new URL('../../server.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
function loadServerFunction(name: string, dependencies: Record<string, unknown>) {
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw new Error(`Server function ${name} not found`);
  const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), `${code}; return ${name};`)(...Object.values(dependencies));
}

const render = loadServerFunction('buildReactVitePreviewHtml', {
  fileByPath: (all: TestFile[], path: string) => all.find(item => item.path === path),
  collectPreviewStyles,
  escapeHtml: (value: string) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
  summarizeForMeta: (value: string) => value,
  slugify: () => 'test-app',
  styleSafeCss,
  scriptSafeJson,
  tailwindConfigScript,
  CODEN_PREVIEW_RENDERER_VERSION,
  CODEN_PREVIEW_BABEL_VERSION: '8.0.4',
  REDUCED_MOTION_PREVIEW_HOOK: '',
  injectAnalyticsSnippet: (html: string) => html,
}) as (sourceFiles: TestFile[], name: string, id: string) => string;

describe('generated app preview styles', () => {
  it('follows component imports and nested CSS imports without adding unused legacy styles', () => {
    const result = collectPreviewStyles(files);
    expect(result.styles.map(style => style.path)).toEqual(['src/components/Hero.css', 'src/index.css']);
    expect(result.styles[0].content).toContain('--ink: #123');
    expect(result.styles[0].content).toContain('display: grid');
    expect(result.styles[0].content).not.toContain('@import "../tokens.css"');
    expect(result.externalStylesheets).toEqual(['https://fonts.googleapis.com/css2?family=Inter']);
  });

  it('renders imported component CSS in the actual preview document', () => {
    const html = render(files, 'Meeting Notes', 'app-1');
    expect(html).toContain('name="coden-preview-css"');
    expect(html).toContain('data-coden-css-path="src/components/Hero.css"');
    expect(html).toContain('.hero { display: grid; }');
    expect(html).toContain('--ink: #123');
    expect(html).not.toContain('.hero { display: none; }');
    expect(html).toContain('href="https://fonts.googleapis.com/css2?family=Inter"');
  });

  it('uses the matching Tailwind runtime for a CSS-first Tailwind 4 app', () => {
    const sourceFiles = [
      file('package.json', JSON.stringify({ devDependencies: { tailwindcss: '^4.1.0', '@tailwindcss/vite': '^4.1.0' } })),
      file('src/main.jsx', "import App from './App'; import './theme.css';"),
      file('src/App.jsx', 'export default function App(){return <main className="bg-brand">Hello</main>}'),
      file('src/theme.css', '@import "tailwindcss"; @theme { --color-brand: #123456; }'),
    ];
    const html = render(sourceFiles, 'Theme app', 'app-2');
    expect(html).toContain('https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4');
    expect(html).toContain('<style type="text/tailwindcss" data-coden-css-path="src/theme.css">');
    expect(html).toContain('--color-brand: #123456');
    expect(html).not.toContain('@import "tailwindcss"');
    expect(html).toContain('"src/main.jsx"');
    expect(html).toContain('entryPoint.startsWith("src/App.")');
  });

  it('refreshes an older saved preview from its persisted files without rewriting real build output', () => {
    const refresh = loadServerFunction('refreshLegacyPreviewStyles', { buildReactVitePreviewHtml: render, CODEN_PREVIEW_RENDERER_VERSION }) as
      (html: string, project: Record<string, string>, sourceFiles: TestFile[], environment: string) => string;
    const project = { id: 'app-1', name: 'Meeting Notes', prompt: 'Notes app', slug: 'meeting-notes' };
    const current = render(files, project.name, project.id);
    const legacy = current.replace(`  <meta name="coden-preview-css" content="${CODEN_PREVIEW_RENDERER_VERSION}" />`, '')
      .replace(/<style data-coden-css-path="[^"]+">[\s\S]*?<\/style>/g, '');
    expect(refresh(legacy, project, files, 'preview')).toContain('.hero { display: grid; }');
    expect(refresh('<html><style>.built{color:red}</style></html>', project, files, 'preview')).toBe('<html><style>.built{color:red}</style></html>');
    expect(refresh(current, project, files, 'preview')).toBe(current);
    expect(refresh(legacy, project, [], 'preview')).toBe(legacy);
    const changedFiles = files.map(item => item.path === 'src/App.tsx' ? file(item.path, item.content + '\n// uncommitted edit') : item);
    expect(refresh(legacy, project, changedFiles, 'production')).toBe(legacy);
  });

  it('never resolves imports outside the saved project files', () => {
    const result = collectPreviewStyles([
      file('src/main.tsx', "import '../outside.css'; import './inside.css';"),
      file('src/inside.css', '.safe { color: green; }'),
    ]);
    expect(result.styles.map(style => style.path)).toEqual(['src/inside.css']);
  });
});
