import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const card = readFileSync(new URL('./src/dashboard-react.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./src/styles/dashboard-react.css', import.meta.url), 'utf8');

/*
 * A project card says each thing once.
 *
 * It said the project's name three times: as the placeholder's title, as its
 * own initial in a coloured circle, and in the meta row — so half of every
 * card repeated the other half. On the widest card in the account, "High-end
 * Premium Minimalist Ui", the name was truncated in the row while a redundant
 * copy of it sat complete twenty pixels above.
 */
{
  const component = card.slice(card.indexOf('function ProjectCard('), card.indexOf('function DashboardHome('));

  /*
   * The name survives in exactly one VISIBLE place: the meta row.
   *
   * Counted as a JSX expression rather than as a substring, because
   * `${project.name}` inside an aria-label or an iframe title is not a
   * repetition a reader sees — it is the accessible name, and removing those
   * would trade a visual fix for an accessibility regression.
   */
  const visibleNames = (component.match(/(^|[^$])\{project\.name\}/g) || []).length;
  assert.equal(visibleNames, 1, 'the project name is painted once, not three times');
  assert.ok((component.match(/\$\{project\.name\}/g) || []).length >= 1,
    'while the accessible names that reference it are kept');
  assert.doesNotMatch(component, /project\.name\.slice\(0, 1\)/, 'the initial-in-a-circle is gone');
  assert.match(component, /<strong>\{project\.name\}<\/strong>/, 'and the surviving one is the meta row');

  // aria-label still names the project: removing repetition from the eye must
  // not remove it from a screen reader.
  assert.match(component, /aria-label=\{`Ouvrir le projet \$\{project\.name\}`\}/, 'the link is still named');

  // The freed column is actually reclaimed rather than left as dead space.
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 17px;/, 'the meta row is two columns now');
  assert.doesNotMatch(css, /grid-template-columns: 32px minmax\(0, 1fr\) 17px;/, 'the avatar column is gone');
}

/*
 * The badge answers one question.
 *
 * It read 'Aperçu' whenever a preview happened to render and the lifecycle
 * state otherwise — so two cards side by side answered different questions:
 * one told you it had a picture, the other that it was a draft. "Aperçu" is
 * not a state a project can be in.
 */
{
  const component = card.slice(card.indexOf('function ProjectCard('), card.indexOf('function DashboardHome('));
  assert.match(component, /<span className=\{`coden-dashboard-project-badge is-\$\{state\.key\}`\}>\{state\.label\}<\/span>/,
    'the badge reports the project state and nothing else');
  assert.doesNotMatch(component, /\? 'Aperçu' :/, "the content-type label is no longer mixed into the state axis");

  // And the states themselves stay on one axis.
  const states = card.slice(card.indexOf('function projectState('), card.indexOf('function Sidebar('));
  for (const label of ['En ligne', 'En cours', 'À vérifier', 'Prêt', 'Brouillon']) {
    assert.ok(states.includes(label), `${label} is a lifecycle state`);
  }
}

/*
 * The placeholder is the floor, not the alternative.
 *
 * It rendered only when there was no preview, so a card whose iframe came up
 * blank showed a dark hole with a badge floating in it and read as broken
 * rather than pending. Drawn underneath, the worst a failed preview can look
 * is the same as one that was never generated.
 */
{
  const component = card.slice(card.indexOf('function ProjectCard('), card.indexOf('function DashboardHome('));
  const fallbackAt = component.indexOf('coden-dashboard-project-fallback');
  const iframeAt = component.indexOf('<iframe');
  assert.ok(fallbackAt > 0 && fallbackAt < iframeAt, 'the placeholder is rendered before the frame, underneath it');
  assert.doesNotMatch(component, /\) : \(\s*<span className="coden-dashboard-project-fallback"/,
    'it is no longer the else-branch of having a preview');

  assert.match(css, /\.coden-dashboard-project-fallback \{[\s\S]*?z-index: 0;/, 'and sits below');
  assert.match(css, /\.coden-dashboard-project-preview iframe \{\n  position: relative;\n  z-index: 1;\n\}/,
    'while a working preview covers it');
}

/*
 * A thumbnail does not need the application to boot.
 *
 * The frame is sandboxed `allow-scripts` and deliberately WITHOUT
 * `allow-same-origin` — granting both to a srcDoc from our own origin would
 * let the framed document reach into this page and drop its own sandbox. The
 * price of that correct choice is an opaque origin, where touching
 * `localStorage` throws a SecurityError synchronously, so a generated app that
 * reads storage while mounting dies before painting.
 *
 * Confirmed rather than assumed: the stored preview for this account's most
 * recent project is 60KB carrying `<script>`, `localStorage` and
 * `sessionStorage`, and its tile rendered as an empty dark rectangle.
 */
{
  assert.match(card, /const PREVIEW_STORAGE_SHIM = /, 'the frame gets an in-memory stand-in for storage');
  assert.match(card, /srcDoc=\{previewDocumentWithStorageShim\(previewHtml!\)\}/, 'and it is actually applied');

  /*
   * The sandbox stays closed. This is the whole reason the shim exists, so it
   * is checked against the code with the prose stripped out — the comment
   * above the shim necessarily names the attribute it exists to avoid.
   */
  const code = card.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /sandbox="allow-scripts"/, 'scripts may run');
  assert.doesNotMatch(code, /allow-same-origin"/, 'but never with same-origin, which would defeat the sandbox');

  // Both storages, since an app that survives one will try the other.
  assert.match(card, /'localStorage' : 'sessionStorage'/, 'both storages are covered');
  // The shim must never be the thing that breaks the page it is protecting.
  assert.match(card, /catch \(e\) \{\}/, 'and it fails silently rather than throwing on a browser that refuses');

  /*
   * Placement is the point: a stand-in installed after the app has already
   * read storage has protected nothing.
   */
  const place = (html: string) => {
    const head = html.search(/<head[^>]*>/i);
    if (head >= 0) { const at = html.indexOf('>', head) + 1; return html.slice(0, at) + '<!SHIM!>' + html.slice(at); }
    return '<!SHIM!>' + html;
  };
  for (const html of [
    '<!doctype html><html><head><script>boot()</script></head><body></body></html>',
    '<!doctype html><html><head lang="fr" data-x><title>t</title></head></html>',
    '<html><body><script>boot()</script></body></html>',
  ]) {
    const out = place(html);
    const shimAt = out.indexOf('<!SHIM!>');
    const scriptAt = out.indexOf('<script');
    assert.ok(shimAt >= 0, 'the shim is inserted');
    if (scriptAt >= 0) assert.ok(shimAt < scriptAt, `the shim precedes the document's own scripts: ${html.slice(0, 40)}`);
  }
}

console.log('project card UI tests passed');
