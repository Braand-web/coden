import { describe, expect, it } from 'vitest';
import {
  checkDesignWrite,
  compareDesign,
  extractCssTokens,
  extractDesignContract,
  extractThemeKeys,
  isDesignLayerPath,
  renderDesignContract,
  restoreDesign,
  wantsDesignChange,
  type DesignFile,
} from './design-contract.ts';
import { applyStarter, selectStarter, themeStarter } from './sandbox/starters.ts';

/** A project as the first build leaves it: the themed scaffold plus the model's own app. */
function generatedProject(prompt = 'Un tableau de bord de suivi de clients pour une agence', seed = 'project-1'): DesignFile[] {
  const starter = themeStarter(selectStarter(prompt), { prompt, seed, title: 'ClientFlow' });
  const { files } = applyStarter(starter, [
    { path: 'src/App.tsx', content: "export default function App(){ return <main className='bg-bg text-content'><h1 className='font-display'>Clients</h1></main>; }" },
  ]);
  return files.map(file => ({ path: file.path, content: file.content }));
}

const withFile = (files: DesignFile[], path: string, content: string) =>
  files.some(file => file.path === path) ? files.map(file => (file.path === path ? { path, content } : file)) : [...files, { path, content }];
const read = (files: DesignFile[], path: string) => files.find(file => file.path === path)!.content;

describe('design contract extraction', () => {
  it("reads the design layer out of a real generated project's files", () => {
    const contract = extractDesignContract(generatedProject());
    const names = new Set(contract.tokens.map(token => token.name));
    for (const name of ['--color-bg', '--color-surface', '--color-accent', '--color-text', '--radius-card', '--shadow-card']) expect(names.has(name)).toBe(true);
    // Both themes are tracked: the dark stage and the light one under [data-theme].
    expect(new Set(contract.tokens.map(token => token.stack.join('>'))).size).toBeGreaterThanOrEqual(2);
    expect(contract.themeKeys).toEqual(expect.arrayContaining(['colors.surface', 'colors.accent', 'borderRadius.card', 'boxShadow.card', 'fontFamily.display']));
    expect(contract.stylesheet).toBe('src/index.css');
    expect(contract.entry).toBe('src/main.tsx');
    expect(contract.importsStylesheet).toBe(true);
    expect(contract.tailwindDirectives).toBe('v3');
    expect(contract.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable: the same files always give the same fingerprint, and a real change gives another', () => {
    const files = generatedProject();
    expect(extractDesignContract(files).fingerprint).toBe(extractDesignContract([...files].reverse()).fingerprint);
    const edited = withFile(files, 'src/index.css', read(files, 'src/index.css').replace(/--color-accent:[^;]+;/, '--color-accent: #ff0000;'));
    expect(extractDesignContract(edited).fingerprint).not.toBe(extractDesignContract(files).fingerprint);
  });

  it('ignores comments, strings and component-local custom properties', () => {
    const tokens = extractCssTokens('a.css', `
      /* :root { --commented: 1; } */
      :root { --real: red; --url: url("data:image/svg+xml;utf8,<svg xmlns='x'/>"); }
      .card { --local: 4px; }
      @keyframes spin { from { --frame: 0 } }
      @media (prefers-color-scheme: dark) { :root { --real: blue } }
    `);
    expect(tokens.map(token => `${token.stack.join('>')}|${token.name}`)).toEqual([
      ':root|--real', ':root|--url', '@media (prefers-color-scheme: dark)>:root|--real',
    ]);
    expect(tokens[1].value).toContain('data:image/svg+xml;utf8');
  });

  it('reads Tailwind theme keys without running the config', () => {
    const keys = extractThemeKeys(`
      const tone = (name) => 'color-mix(in oklch, var(' + name + ') calc(<alpha-value> * 100%), transparent)';
      export default { theme: { extend: {
        colors: { bg: tone('--color-bg'), 'surface-raised': tone('--color-surface-raised'), ...other },
        borderRadius: { card: 'var(--radius-card)' },
        keyframes: { 'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } } },
      } } };
    `);
    expect(keys).toEqual(['borderRadius.card', 'colors.bg', 'colors.surface-raised', 'keyframes.fade-in']);
  });

  it('does not treat re-organising a stylesheet as removing its tokens', () => {
    const before = extractDesignContract([{ path: 'src/index.css', content: ":root { --a: 1; }\n[data-theme='light'] { --a: 2; }" }]);
    const after = extractDesignContract([{ path: 'src/index.css', content: '@layer base { :root { --a: 1; } [data-theme="light"] { --a: 2; } }' }]);
    expect(compareDesign(before, after)).toEqual([]);
  });
});

describe('design writes at the tool boundary', () => {
  const files = generatedProject();
  const css = read(files, 'src/index.css');

  it('accepts extending the stylesheet — a new class, a new token', () => {
    const verdict = checkDesignWrite({ path: 'src/index.css', before: css, after: `${css}\n.pricing-card { border-radius: var(--radius-card); }\n:root { --color-highlight: gold; }`, allowValueChanges: false });
    expect(verdict.ok).toBe(true);
  });

  it('refuses rewriting the stylesheet without the tokens the app reads', () => {
    const verdict = checkDesignWrite({ path: 'src/index.css', before: css, after: '.hero { color: red; }', allowValueChanges: false });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error).toContain('src/index.css');
    expect(verdict.error).toContain('removes --color-');
    expect(verdict.hint).toContain('edit_file');
    expect(verdict.violations.some(violation => violation.kind === 'tailwind_directives_removed')).toBe(true);
  });

  it('refuses a new colour for an existing token unless the user asked for a different look', () => {
    const after = css.replace(/--color-accent:[^;]+;/, '--color-accent: #ff00aa;');
    expect(checkDesignWrite({ path: 'src/index.css', before: css, after, allowValueChanges: false }).ok).toBe(false);
    expect(checkDesignWrite({ path: 'src/index.css', before: css, after, allowValueChanges: true }).ok).toBe(true);
  });

  it('never allows a token to disappear, even when the look is being changed', () => {
    const after = css.replace(/\s*--color-accent:[^;]+;/, '');
    expect(checkDesignWrite({ path: 'src/index.css', before: css, after, allowValueChanges: true }).ok).toBe(false);
  });

  it('refuses an entry that stops importing the stylesheet, and a config that loses theme keys', () => {
    const main = read(files, 'src/main.tsx');
    expect(checkDesignWrite({ path: 'src/main.tsx', before: main, after: main.replace(/import '\.\/index\.css';\n?/, ''), allowValueChanges: true }).ok).toBe(false);
    expect(checkDesignWrite({ path: 'src/main.tsx', before: main, after: `${main}\n// touched`, allowValueChanges: false }).ok).toBe(true);
    const config = read(files, 'tailwind.config.js');
    expect(checkDesignWrite({ path: 'tailwind.config.js', before: config, after: 'export default { theme: { extend: { colors: { brand: "red" } } } };', allowValueChanges: true }).ok).toBe(false);
    expect(checkDesignWrite({ path: 'tailwind.config.js', before: config, after: config.replace("card: 'var(--radius-card)',", "card: 'var(--radius-card)',\n        hero: '32px',"), allowValueChanges: false }).ok).toBe(true);
  });

  it('refuses dropping the font link from index.html', () => {
    const html = read(files, 'index.html');
    expect(html).toMatch(/fonts\.googleapis\.com/);
    expect(checkDesignWrite({ path: 'index.html', before: html, after: html.replace(/<link[^>]*fonts\.googleapis[^>]*>\s*/g, ''), allowValueChanges: false }).ok).toBe(false);
  });

  it('leaves application code and new files alone', () => {
    expect(isDesignLayerPath('src/components/Hero.tsx')).toBe(false);
    expect(checkDesignWrite({ path: 'src/App.tsx', before: 'a', after: 'b', allowValueChanges: false }).ok).toBe(true);
    expect(checkDesignWrite({ path: 'src/pricing.css', before: null, after: '.x{}', allowValueChanges: false }).ok).toBe(true);
  });
});

describe('design safety net after a run', () => {
  it('puts back what a careless rewrite removed, and keeps the run\'s own new styles', () => {
    const baseline = generatedProject();
    const rewritten = withFile(
      withFile(baseline, 'src/index.css', '.pricing { display: grid; gap: 1rem; }'),
      'src/main.tsx',
      "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);",
    );
    const before = extractDesignContract(baseline);
    const violations = compareDesign(before, extractDesignContract(rewritten));
    expect(violations.length).toBeGreaterThan(10);

    const { files, unrepaired } = restoreDesign(baseline, rewritten, violations);
    expect(unrepaired).toEqual([]);
    expect(compareDesign(before, extractDesignContract(files))).toEqual([]);
    expect(extractDesignContract(files).fingerprint).toBe(before.fingerprint);
    expect(read(files, 'src/index.css')).toContain('.pricing { display: grid; gap: 1rem; }');
    expect(read(files, 'src/main.tsx')).toContain("import './index.css';");
  });

  it('restores a deleted stylesheet, a deleted font link and a config that lost its keys', () => {
    const baseline = generatedProject();
    const broken = baseline
      .filter(file => file.path !== 'src/index.css')
      .map(file => file.path === 'index.html' ? { ...file, content: file.content.replace(/<link[^>]*fonts\.googleapis[^>]*>\s*/g, '') } : file)
      .map(file => file.path === 'tailwind.config.js' ? { ...file, content: 'export default { theme: { extend: { colors: { brand: "red" } } } };' } : file);
    const before = extractDesignContract(baseline);
    const { files, unrepaired } = restoreDesign(baseline, broken, compareDesign(before, extractDesignContract(broken)));
    expect(unrepaired).toEqual([]);
    expect(extractDesignContract(files).fingerprint).toBe(before.fingerprint);
  });

  it('restores a value a run changed without being asked', () => {
    const baseline = generatedProject();
    const changed = withFile(baseline, 'src/index.css', read(baseline, 'src/index.css').replace(/--color-accent:[^;]+;/, '--color-accent: hotpink;'));
    const before = extractDesignContract(baseline);
    const violations = compareDesign(before, extractDesignContract(changed));
    expect(violations.map(violation => violation.kind)).toEqual(['token_changed']);
    expect(extractDesignContract(restoreDesign(baseline, changed, violations).files).fingerprint).toBe(before.fingerprint);
  });
});

describe('what the agent is told', () => {
  it('states the contract with real names and values, compactly', () => {
    const text = renderDesignContract(extractDesignContract(generatedProject()));
    expect(text).toContain('DESIGN CONTRACT');
    expect(text).toContain('--color-surface=');
    expect(text).toContain('colors: ');
    expect(text).toContain('edit_file');
    expect(text).toContain('did not ask for a different look');
    expect(text.length).toBeLessThan(6_000);
    expect(renderDesignContract(extractDesignContract(generatedProject()), { allowValueChanges: true })).toContain('token VALUES may change');
    expect(renderDesignContract(extractDesignContract([]))).toBe('');
  });

  it('recognises a request for a different look, in French and English', () => {
    for (const yes of ['change la couleur principale en vert', 'je veux aussi un thème clair', 'Make it dark mode', 'refonte du design', 'use a different font']) expect(wantsDesignChange(yes)).toBe(true);
    for (const no of ['il faut une landing page', 'corrige le bouton enregistrer', 'ajoute une page de facturation', 'mon app a perdu sa mise en page']) expect(wantsDesignChange(no)).toBe(false);
  });
});
