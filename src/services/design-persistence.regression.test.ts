/**
 * The regression this suite exists for: a generated app kept its design on the
 * first build and lost it afterwards — after an iteration, and again after the
 * page was reloaded or the project reopened.
 *
 * It replays that life end to end against the real modules — the themed
 * scaffold, the sandbox tools an agent actually calls, the contract, the
 * safety net, the persistence round trip and the preview renderer:
 *
 *   generate → iterate ×N (with an agent that tries to overwrite the design)
 *            → reload → close and reopen → restore an old version
 *
 * and asserts, after every step, that the design is the same design.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createSandboxTools } from './sandbox/sandbox-tools.ts';
import { applyStarter, selectStarter, themeStarter } from './sandbox/starters.ts';
import { compareDesign, extractDesignContract, restoreDesign, wantsDesignChange, type DesignFile } from './design-contract.ts';
import { CODEN_PREVIEW_RENDERER_VERSION, collectPreviewStyles, scriptSafeJson, styleSafeCss, tailwindConfigScript } from './preview-embedding.ts';
import { redactSecrets } from './secret-redaction.ts';

/* ── the real preview renderer, lifted out of server.ts ─────────────── */
const source = ts.createSourceFile('server.ts', readFileSync(new URL('../../server.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
function serverFunction(name: string, dependencies: Record<string, unknown>) {
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw new Error(`server function ${name} not found`);
  const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), `${code}; return ${name};`)(...Object.values(dependencies));
}
const renderPreview = serverFunction('buildReactVitePreviewHtml', {
  fileByPath: (all: DesignFile[], path: string) => all.find(item => item.path === path),
  collectPreviewStyles,
  escapeHtml: (value: string) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
  summarizeForMeta: (value: string) => value,
  slugify: () => 'client-flow',
  styleSafeCss,
  scriptSafeJson,
  tailwindConfigScript,
  CODEN_PREVIEW_RENDERER_VERSION,
  CODEN_PREVIEW_BABEL_VERSION: '8.0.4',
  REDUCED_MOTION_PREVIEW_HOOK: '',
  injectAnalyticsSnippet: (html: string) => html,
}) as (files: DesignFile[], name: string, id: string) => string;

/* ── a project store: what the database does to files between requests ─ */
class ProjectStore {
  private rows = '[]';
  save(files: DesignFile[]) { this.rows = JSON.stringify(files.map(file => ({ path: file.path, content: file.content }))); }
  /** `loadProjectFiles`: read the rows back, secrets redacted, ordered by path. */
  load(): DesignFile[] {
    return (JSON.parse(this.rows) as DesignFile[]).map(file => ({ ...file, content: redactSecrets(file.content) })).sort((a, b) => a.path.localeCompare(b.path));
  }
}

/* ── an in-memory sandbox behind the real tools ─────────────────────── */
function sandboxFor(files: DesignFile[]) {
  const disk = new Map(files.map(file => [file.path, file.content]));
  const sandbox: any = {
    projectId: 'client-flow',
    status: () => ({ state: 'running', basePath: '/preview/x/' }),
    readProjectFile: async (path: string) => { if (!disk.has(path)) throw new Error('ENOENT'); return disk.get(path)!; },
    writeFiles: async (list: DesignFile[]) => { for (const file of list) disk.set(file.path, file.content); return list.map(file => file.path); },
    deleteProjectFile: async (path: string) => { disk.delete(path); },
    hasFile: async (path: string) => disk.has(path),
    listFiles: async () => [...disk.keys()].sort(),
  };
  return { sandbox, snapshot: (): DesignFile[] => [...disk].map(([path, content]) => ({ path, content })) };
}

const PROMPT = 'Un tableau de bord de suivi de clients pour une agence, sobre et lisible';
function firstBuild(): DesignFile[] {
  const starter = themeStarter(selectStarter(PROMPT), { prompt: PROMPT, seed: 'client-flow', title: 'ClientFlow' });
  const { files } = applyStarter(starter, [
    { path: 'src/App.tsx', content: "import { Clients } from './components/Clients';\nexport default function App(){ return <main className='min-h-screen bg-bg text-content'><Clients /></main>; }" },
    { path: 'src/components/Clients.tsx', content: "export function Clients(){ return <section className='rounded-card bg-surface shadow-card p-6 font-display'>Clients</section>; }" },
  ]);
  return files.map(file => ({ path: file.path, content: file.content }));
}

/** One iteration: an agent working through the real tools, with the guard the pipeline gives it. */
async function iterate(files: DesignFile[], prompt: string, work: (tools: ReturnType<typeof createSandboxTools>) => Promise<void>) {
  const { sandbox, snapshot } = sandboxFor(files);
  const refused: string[] = [];
  const allowValueChanges = wantsDesignChange(prompt);
  const tools = createSandboxTools('client-flow', { sandbox, design: { allowValueChanges, onBlocked: info => refused.push(`${info.tool}:${info.path}`) } });
  await work(tools);
  return { files: snapshot(), refused };
}

const fingerprint = (files: DesignFile[]) => extractDesignContract(files).fingerprint;
const read = (files: DesignFile[], path: string) => files.find(file => file.path === path)!.content;

describe('a generated app keeps its design across its whole life', () => {
  it('survives careless iterations, a reload, a close and reopen, and a restore', async () => {
    const store = new ProjectStore();
    const versions: DesignFile[][] = [];

    // ── 1. generate ────────────────────────────────────────────────────
    let project = firstBuild();
    store.save(project);
    versions.push(project);
    const designV1 = fingerprint(project);
    const previewV1 = renderPreview(project, 'ClientFlow', 'client-flow');
    expect(extractDesignContract(project).tokens.length).toBeGreaterThan(20);

    // ── 2. iteration: "add a billing page" — the agent rewrites the stylesheet "to add a class" ──
    let step = await iterate(store.load(), 'ajoute une page de facturation', async tools => {
      await tools.call('write_file', { path: 'src/components/Billing.tsx', content: "export function Billing(){ return <section className='rounded-card bg-surface p-6'>Facturation</section>; }" });
      // The whole stylesheet, replaced by just the new class: what used to erase every token.
      const rewritten = await tools.call('write_file', { path: 'src/index.css', content: '.billing-grid { display: grid; gap: 1rem; }' });
      expect(rewritten.ok).toBe(false);
      // The way back the tool points to: extend, don't replace.
      const css = (await tools.call('read_file', { path: 'src/index.css' })) as any;
      const tail = css.content.slice(-40);
      const extended = await tools.call('edit_file', { path: 'src/index.css', find: tail, replace: `${tail}\n.billing-grid { display: grid; gap: 1rem; }` });
      expect(extended.ok).toBe(true);
    });
    expect(step.refused).toEqual(['write_file:src/index.css']);
    project = step.files;
    store.save(project);
    versions.push(project);
    expect(fingerprint(project)).toBe(designV1);
    expect(read(project, 'src/index.css')).toContain('.billing-grid');

    // ── 3. iteration: "fix the bug" — the agent rewrites the entry and drops the stylesheet import ──
    step = await iterate(store.load(), 'corrige le bouton enregistrer', async tools => {
      const entry = await tools.call('write_file', {
        path: 'src/main.tsx',
        content: "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
      });
      expect(entry.ok).toBe(false);
      // …and rewrites the stylesheet with a different accent colour, unasked.
      const recolour = await tools.call('write_file', { path: 'src/index.css', content: read(project, 'src/index.css').replace(/--color-accent:[^;]+;/g, '--color-accent: hotpink;') });
      expect(recolour.ok).toBe(false);
    });
    expect(step.refused).toEqual(['write_file:src/main.tsx', 'write_file:src/index.css']);
    project = step.files;
    expect(fingerprint(project)).toBe(designV1);
    expect(read(project, 'src/main.tsx')).toContain("import './index.css';");
    store.save(project);

    // ── 4. iteration the user DID ask to restyle: the value changes, nothing disappears ──
    const before = extractDesignContract(project);
    step = await iterate(store.load(), 'change la couleur principale en vert', async tools => {
      const css = read(project, 'src/index.css');
      const recoloured = css.replace(/--color-accent:[^;]+;/g, '--color-accent: oklch(0.7 0.15 150);');
      expect((await tools.call('write_file', { path: 'src/index.css', content: recoloured })).ok).toBe(true);
      // Even now a token cannot be deleted.
      expect((await tools.call('write_file', { path: 'src/index.css', content: recoloured.replace(/--color-info/g, '--color-info-removed') })).ok).toBe(false);
    });
    project = step.files;
    store.save(project);
    versions.push(project);
    const designV4 = fingerprint(project);
    expect(designV4).not.toBe(designV1);
    expect(compareDesign(before, extractDesignContract(project), { allowValueChanges: true })).toEqual([]);

    // ── 5. something slips past the tools (a shell rewrite): the safety net puts the design back ──
    const slipped = project.map(file => file.path === 'src/index.css' ? { ...file, content: '.only-this { color: red; }' } : file);
    const violations = compareDesign(extractDesignContract(project), extractDesignContract(slipped), { allowValueChanges: true });
    expect(violations.length).toBeGreaterThan(10);
    const net = restoreDesign(project, slipped, violations);
    expect(net.unrepaired).toEqual([]);
    expect(fingerprint(net.files)).toBe(designV4);
    expect(read(net.files, 'src/index.css')).toContain('.only-this');

    // ── 6. reload: what the server hands the browser is the same app, styled ──
    const reloaded = store.load();
    expect(fingerprint(reloaded)).toBe(designV4);
    const previewBefore = renderPreview(project, 'ClientFlow', 'client-flow');
    const previewAfter = renderPreview(reloaded, 'ClientFlow', 'client-flow');
    expect(previewAfter).toBe(previewBefore);

    // ── 7. close and reopen: a fresh session, fresh objects, the same rows ──
    const reopened = new ProjectStore();
    reopened.save(JSON.parse(JSON.stringify(store.load())));
    expect(fingerprint(reopened.load())).toBe(designV4);
    expect(renderPreview(reopened.load(), 'ClientFlow', 'client-flow')).toBe(previewBefore);

    // ── 8. the reopened preview really carries the design: run its Tailwind config and read its tokens ──
    const config = /<script>\n(\(function \(\) \{[\s\S]*?\}\)\(\);)\n  <\/script>/.exec(previewAfter)?.[1];
    expect(config, 'the preview runs the project\'s tailwind config').toBeTruthy();
    const window: any = { tailwind: {} };
    vm.runInNewContext(config!, { window, console: { warn: (message: unknown) => { throw new Error(String(message)); } } });
    expect(window.tailwind.config.theme.extend.colors.surface).toContain('var(--color-surface)');
    expect(window.tailwind.config.theme.extend.borderRadius.card).toBe('var(--radius-card)');
    for (const token of extractDesignContract(reloaded).tokens.slice(0, 40)) {
      expect(previewAfter, `${token.name} is in the reopened preview`).toContain(`${token.name}:`);
    }
    expect(previewAfter).toContain('data-coden-css-path="src/index.css"');
    expect(previewAfter).toContain('.billing-grid');

    // ── 9. restore version 1: files, tokens and preview are exactly the first build's ──
    store.save(versions[0]);
    expect(fingerprint(store.load())).toBe(designV1);
    expect(renderPreview(store.load(), 'ClientFlow', 'client-flow')).toBe(previewV1);
  });

  it('a project whose starter config the old preview could not read is styled by the new one', () => {
    const files = firstBuild();
    const html = renderPreview(files, 'ClientFlow', 'client-flow');
    // The failure being fixed: no `tailwind.config` reached the preview, so bg-surface and rounded-card were nothing.
    expect(html).toContain('window.tailwind.config = cfg');
    expect(html).toContain(`content="${CODEN_PREVIEW_RENDERER_VERSION}"`);
  });
});
