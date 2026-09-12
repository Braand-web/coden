import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tsx = readFileSync(new URL('./src/dashboard-react.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./src/styles/dashboard-react.css', import.meta.url), 'utf8');
const horizon = readFileSync(new URL('./src/styles/coden-horizon-system.css', import.meta.url), 'utf8');

/*
 * The dashboard stands on a gradient, and the gradient actually reaches it.
 *
 * A background is only a background if nothing above it is opaque. The page
 * ground, the React root, the shell and the sidebar are four stacked boxes
 * that each used to paint the same flat colour — the top one won and the
 * other three were invisible work. Only one surface is opaque now: the panel
 * that holds the content.
 */
{
  assert.match(css, /--dashboard-ambient:\s*\n?\s*radial-gradient/, 'the ground is a gradient, not a fill');
  assert.match(css, /background-image: var\(--dashboard-ambient\);/, 'and the page paints it');

  const root = css.slice(css.indexOf('#coden-dashboard-react-root {'));
  assert.match(root.slice(0, 160), /background: transparent;/, 'the root lets it through');

  const shell = css.slice(css.indexOf('.coden-dashboard-shell {'));
  assert.match(shell.slice(0, 260), /background: transparent;/, 'so does the shell');

  const sidebar = css.slice(css.indexOf('.coden-dashboard-sidebar {'));
  assert.match(sidebar.slice(0, 420), /background: transparent;/, 'so does the sidebar');

  /*
   * Both themes, because a gradient defined only in the dark block leaves the
   * light theme painting `var(--dashboard-ambient)` as nothing at all.
   */
  const light = css.slice(css.indexOf('html[data-theme="light"] {'));
  assert.match(light.slice(0, light.indexOf('}')), /--dashboard-ambient:/, 'the light theme has its own');
}

/*
 * The design system stopped overpainting it.
 *
 * `coden-horizon-system.css` loads after the dashboard stylesheet and carried
 * `background: var(--horizon-canvas) !important` on the shell, the main panel
 * and the root — three `!important` flat fills that no rule in the dashboard
 * stylesheet could have beaten. Whatever ships there, this is the layer that
 * decides what production looks like.
 */
{
  const scoped = horizon.slice(horizon.indexOf('body[data-coden-surface="dashboard"]'));
  assert.doesNotMatch(scoped, /\.coden-dashboard-shell[^{]*\{[^}]*background:[^}]*!important/,
    'the shell is no longer force-filled');
  assert.doesNotMatch(scoped, /#coden-dashboard-react-root[^{]*\{[^}]*background:[^}]*!important/,
    'nor the root');
  assert.doesNotMatch(scoped, /\.coden-dashboard-sidebar\s*\{[^}]*background:[^}]*!important/,
    'nor the sidebar');

  // It still owns the palette — that is its job, and the gradient uses it.
  assert.match(scoped, /--dashboard-ambient:/, 'it supplies the gradient in its own colours');
  assert.match(scoped, /var\(--horizon-canvas\)/, 'built on the canvas it already defines');
}

/*
 * Every layer of the gradient is an image.
 *
 * `background-image` accepts images only. A bare colour in the last slot —
 * the natural way to write "and a flat base underneath" — makes the whole
 * declaration invalid at computed-value time, so the browser drops all four
 * layers and paints nothing, with no error anywhere. Both definitions of the
 * token are checked, since one of them silently failing is invisible in the
 * other theme.
 */
{
  for (const [source, where] of [[css, 'dashboard-react.css'], [horizon, 'coden-horizon-system.css']] as const) {
    for (const match of source.matchAll(/--dashboard-ambient:([\s\S]*?);\s*\n/g)) {
      // Split on top-level commas only: every layer is itself full of them.
      const value = match[1].replace(/\/\*[\s\S]*?\*\//g, '');
      const layers: string[] = [];
      let depth = 0;
      let current = '';
      for (const char of value) {
        if (char === '(') depth += 1;
        else if (char === ')') depth -= 1;
        if (char === ',' && depth === 0) { layers.push(current); current = ''; continue; }
        current += char;
      }
      layers.push(current);
      const trimmed = layers.map((layer) => layer.trim()).filter(Boolean);
      assert.ok(trimmed.length >= 2, `${where}: the ambient is layered`);
      for (const layer of trimmed) {
        assert.match(layer, /^(?:repeating-)?(?:linear|radial|conic)-gradient\(|^url\(|^image-set\(/,
          `${where}: "${layer.slice(0, 48)}" is an image, not a bare colour`);
      }
    }
  }
}

/* The content sits in one rounded panel with a gutter around it. */
{
  const mainAt = css.indexOf('.coden-dashboard-main {');
  assert.ok(mainAt > 0, 'the content panel is styled');
  const block = css.slice(mainAt, css.indexOf('}', mainAt));
  assert.match(block, /border-radius: var\(--dashboard-panel-radius\);/, 'the panel has rounded edges');
  assert.match(block, /background: var\(--dashboard-panel\);/, 'and is the one opaque surface');
  assert.match(css, /\.coden-dashboard-shell \{[^}]*padding: var\(--dashboard-gutter\);/,
    'with room around it for the gradient to show');

  /*
   * Except on a phone, where the panel is the screen: a 10px gutter there is
   * a wasted 10px on each side and a drawer that no longer reaches the edge.
   */
  const mobile = css.slice(css.indexOf('@media (max-width: 767px)'));
  assert.match(mobile, /\.coden-dashboard-shell \{\s*padding: 0;/, 'the gutter collapses on a phone');
  assert.match(mobile, /\.coden-dashboard-main \{\s*border: 0;\s*border-radius: 0;/, 'and so does the radius');
}

/*
 * The page says "Mes projets" once.
 *
 * A 32px banner reading "Espace de travail / Mes projets" sat directly above
 * a toolbar whose first tab also reads "Mes projets" — ninety vertical pixels
 * and two type sizes spent repeating the tab underneath it. The heading is
 * kept for anyone navigating by headings; it just stopped taking the space.
 */
{
  assert.doesNotMatch(tsx, /coden-dashboard-heading/, 'the banner is gone from the markup');
  assert.doesNotMatch(css, /\.coden-dashboard-heading/, 'and from the stylesheet, including its mobile rules');

  assert.match(tsx, /<h2 className="coden-dashboard-section-title">Mes projets<\/h2>/,
    'the section still has a heading');
  const titleAt = css.indexOf('.coden-dashboard-section-title {');
  assert.ok(titleAt > 0, 'and the heading is styled rather than left unstyled');
  const block = css.slice(titleAt, css.indexOf('}', titleAt));
  assert.match(block, /clip-path: inset\(50%\);/, 'hidden from the eye');
  assert.doesNotMatch(block, /display: none/, 'but never from the accessibility tree');

  // The count it used to carry survives rather than being dropped on the floor.
  assert.match(tsx, /className="coden-dashboard-project-count"/, 'the project count moved into the toolbar');
}

/*
 * The state badge is readable on whatever the preview paints.
 *
 * It was a near-black chip at bottom-right, which is where generated apps put
 * their own dark footers — the label disappeared into the thumbnail on every
 * card whose app had a dark theme. A light pill on the opposite corner is
 * legible over both.
 */
{
  const badgeAt = css.indexOf('.coden-dashboard-project-badge {');
  assert.ok(badgeAt > 0, 'the badge is still styled');
  const block = css.slice(badgeAt, css.indexOf('}', badgeAt));
  assert.match(block, /left: 9px;/, 'anchored to the left edge');
  assert.match(block, /bottom: 9px;/, 'and to the bottom');
  assert.doesNotMatch(block, /right:/, 'and not still pinned right as well');
  assert.match(block, /background: rgba\(255, 255, 255, \.92\);/, 'a light pill');
  assert.match(block, /border-radius: 999px;/, 'actually a pill');
  assert.match(block, /z-index: 2;/, 'above the frame it labels');

  /*
   * The state colours had to follow it. Kept as the dark end of the same
   * hues — #8de5ae on white is unreadable, and silently keeping it would have
   * traded one invisible badge for another.
   */
  for (const [state, hex] of [['published', '#0f7a43'], ['issue', '#b3261e'], ['building', '#1d4ed8']] as const) {
    assert.match(css, new RegExp(`\\.coden-dashboard-project-badge\\.is-${state} \\{\\s*color: ${hex};`),
      `the ${state} colour reads on a light pill`);
  }
}

/*
 * The card is one box.
 *
 * The thumbnail carried the border and the caption floated underneath it
 * unenclosed, so a row of cards read as a row of pictures with loose text
 * between them. One rounded, clipping container holds both.
 */
{
  const cardAt = css.indexOf('.coden-dashboard-project-card {');
  assert.ok(cardAt > 0, 'the card is styled');
  const block = css.slice(cardAt, css.indexOf('}', cardAt));
  assert.match(block, /overflow: hidden;/, 'the card clips its contents');
  assert.match(block, /border-radius: 16px;/, 'with rounded edges');
  assert.match(block, /border: 1px solid var\(--dashboard-border-soft\);/, 'and a single border');

  const previewAt = css.indexOf('.coden-dashboard-project-preview {');
  assert.ok(previewAt > 0, 'the thumbnail is styled');
  const previewBlock = css.slice(previewAt, css.indexOf('}', previewAt));
  assert.match(previewBlock, /border: 0;/, 'so the thumbnail inside it carries none of its own');

  /*
   * A clipping box eats an inner outline, so the focus ring had to move out
   * with it — otherwise a focused card looked exactly like an unfocused one.
   */
  assert.match(css, /\.coden-dashboard-project-card:has\(\.coden-dashboard-project-card-link:focus-visible\) \{/,
    'the focus ring is drawn on the card');
  assert.doesNotMatch(css, /\.coden-dashboard-project-card-link:focus-visible \{/,
    'and not inside where it would be clipped away');
}

console.log('dashboard surface tests passed');
