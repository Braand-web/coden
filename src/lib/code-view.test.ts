import { describe, expect, it } from 'vitest';
import { buildFileTree, highlightLines, languageOf } from './code-view';

describe('buildFileTree', () => {
  it('nests folders, folders first, index.html and package.json leading', () => {
    const tree = buildFileTree(['src/App.tsx', 'package.json', 'src/components/Card.tsx', 'README.md', 'index.html', 'api/contacts.ts']);
    expect(tree.map(node => node.name)).toEqual(['api', 'src', 'index.html', 'package.json', 'README.md']);
    const src = tree[1];
    expect(src.kind).toBe('folder');
    if (src.kind !== 'folder') return;
    expect(src.children.map(node => node.name)).toEqual(['components', 'App.tsx']);
    const components = src.children[0];
    expect(components.kind === 'folder' && components.children[0]).toMatchObject({ kind: 'file', name: 'Card.tsx', path: 'src/components/Card.tsx' });
  });
});

describe('highlightLines', () => {
  it('escapes generated content so it can never run', () => {
    const lines = highlightLines('const html = "<script>alert(1)</script>";', 'js');
    expect(lines.join('\n')).not.toContain('<script>');
    expect(lines[0]).toContain('&lt;script&gt;');
  });

  it('keeps one entry per source line and closes spans at line ends', () => {
    const source = '/* one\ntwo */\nconst a = 1;\n';
    const lines = highlightLines(source, 'js');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('<span class="syn-comment">/* one</span>');
    expect(lines[1]).toBe('<span class="syn-comment">two */</span>');
    expect(lines[2]).toContain('<span class="syn-keyword">const</span>');
    expect(lines[2]).toContain('<span class="syn-number">1</span>');
  });

  it('colours JSON keys apart from values', () => {
    const [line] = highlightLines('{ "name": "pulse", "private": true }', 'json');
    expect(line).toContain('<span class="syn-prop">&quot;name&quot;</span>');
    expect(line).toContain('<span class="syn-string">&quot;pulse&quot;</span>');
    expect(line).toContain('<span class="syn-keyword">true</span>');
  });

  it('marks tags and attributes in HTML', () => {
    const [line] = highlightLines('<div id="root"></div>', 'html');
    expect(line).toContain('<span class="syn-tag">&lt;div</span>');
    expect(line).toContain('<span class="syn-attr">id</span>');
  });

  it('leaves unknown languages as escaped plain text', () => {
    expect(highlightLines('a < b', 'text')).toEqual(['a &lt; b']);
  });
});

describe('languageOf', () => {
  it('names the common kinds', () => {
    expect(languageOf('src/App.tsx')).toEqual({ id: 'js', label: 'TypeScript React' });
    expect(languageOf('styles.css').id).toBe('css');
    expect(languageOf('Dockerfile').label).toBe('DOCKERFILE');
  });
});

describe('type colouring', () => {
  it('colours annotated types but not capitalised words in JSX text', () => {
    const [annotated] = highlightLines('const props: Props = {};', 'js');
    expect(annotated).toContain('<span class="syn-type">Props</span>');
    const [text] = highlightLines('<h1>Votre activité</h1>', 'js');
    expect(text).not.toContain('syn-type');
  });
});
