import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Exercise the actual server functions without starting the server or accessing production.
const source = ts.createSourceFile('server.ts', readFileSync(new URL('../../server.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
function load(name: string, dependencies: Record<string, unknown>) {
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), `${code}; return ${name};`)(...Object.values(dependencies));
}
const file = (path: string, content: string) => ({ path, content });
const dependencies = {
  inferGeneratedLanguage: () => 'text',
  fileByPath: (files: any[], path: string) => files.find(f => f.path === path),
  escapeHtml: (text: string) => text,
  summarizeForMeta: (text: string) => text,
  detectCodenCloudRequirements: () => ({}),
  shouldApplyCodenFullstackKit: () => false,
  manifestFile: () => file('coden.runtime.json', '{}'),
  CODEN_AGENT_FLAGS: { universalManifest: false },
};
const scaffold = load('ensureModernFrontendProject', dependencies);
const base = [
  file('package.json', JSON.stringify({ scripts: { build: 'vite build', test: 'vitest run' }, dependencies: { react: '^19.0.0' } })),
  file('src/App.jsx', 'export default function App(){return <h1>Studio</h1>}'),
  file('src/main.jsx', 'import App from "./App.jsx"; import "./brand.css";'),
  file('src/brand.css', ':root { --brand: #ac4132; }'),
  file('index.html', '<html><head><link rel="stylesheet" href="/fonts.css"></head><body><div class="app" id="root"></div><script src="/src/main.jsx" type="module"></script></body></html>'),
];

describe('generated app preservation during scaffolding and repair', () => {
  it('preserves existing config variants and their design tokens', () => {
    const files = [...base, file('tailwind.config.js', 'export default {theme:{extend:{colors:{brand:"red"}}}}'), file('postcss.config.mjs', 'export default {plugins:{custom:{}}}'), file('vite.config.js', 'export default {plugins:[]}')];
    const result = scaffold(files, 'Studio');
    for (const original of files) expect(result.find((f: any) => f.path === original.path)?.content).toBe(original.content);
    expect(result.some((f: any) => ['tailwind.config.ts', 'postcss.config.cjs', 'vite.config.ts'].includes(f.path))).toBe(false);
  });

  it('does not install Tailwind 3 configuration into Tailwind 4 apps', () => {
    const files = base.map(f => f.path === 'package.json' ? file(f.path, JSON.stringify({ dependencies: { tailwindcss: '^4.1.0', '@tailwindcss/vite': '^4.1.0' } })) : f);
    const result = scaffold(files, 'Studio');
    expect(result.some((f: any) => /^(tailwind|postcss)\.config\./.test(f.path))).toBe(false);
  });

  it('keeps styles and components beyond the old 80-file cutoff', () => {
    const files = [...base, ...Array.from({ length: 110 }, (_, i) => file(`src/components/Part${i}.tsx`, `export const Part${i} = () => null;`)), file('src/theme.css', ':root {color:red}')];
    const result = scaffold(files, 'Studio');
    for (const original of files) expect(result.find((f: any) => f.path === original.path)?.content).toBe(original.content);
    const normalize = load('normalizeGeneratedFiles', { isSafeProjectFilePath: () => true });
    expect(normalize(files)).toHaveLength(files.length);
  });

  it('does not erase the HTML, theme, scripts or plugins on a generic runner failure', () => {
    const files = [...base, file('src/index.css', ':root {--brand: red}'), file('tailwind.config.ts', 'export default {theme:{extend:{colors:{brand:"red"}}}}'), file('postcss.config.cjs', 'module.exports={plugins:{custom:{}}}')];
    const repair = load('runAutoFixEngine', {
      cleanGeneratedBlockingMarkers: (files: any[]) => ({ files, changed: false }),
      isModernFrontendProject: () => true,
      ensureModernFrontendProject: scaffold,
      generatedPath: (path: string) => path,
      applyGeneratedDestructiveSafety: (files: any[]) => files,
      setGeneratedFile: (map: Map<string, any>, path: string, content: string) => map.set(path, file(path, content)),
    });
    const result = repair({ name: 'Studio', id: 'test' }, files, [{ message: 'runner: runtime error in an event handler' }]);
    for (const original of files) expect(result.files.find((f: any) => f.path === original.path)?.content).toBe(original.content);
  });
});
