import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * A rule block, found by its selector standing at the start of a line.
 *
 * `indexOf('.x {')` also matches `.y:active .x {`, so adding any descendant
 * rule earlier in the file silently repointed these lookups at the wrong
 * block — and the assertion then failed on code that was perfectly correct.
 */
function block(css: string, selector: string): string {
  const at = css.search(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm'));
  assert.ok(at >= 0, `the rule for ${selector} exists`);
  return css.slice(at, css.indexOf('}', at));
}

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

  /*
   * The sidebar is a panel of its own now, not a transparent strip.
   *
   * This asserted `background: transparent` when the sidebar rode directly on
   * the mesh. It became a floating panel like the content beside it, which is
   * a better answer to the same problem: an opaque ground lets its ink follow
   * the theme again instead of needing a palette that ignores it. What still
   * has to hold is that the gradient reaches the page at all — the shell and
   * the root above are what guarantee that, and both are checked above.
   */
  const sidebar = block(css, '.coden-dashboard-sidebar');
  assert.match(sidebar, /background: var\(--dashboard-panel\);/, 'the sidebar is a panel');
  assert.match(sidebar, /border-radius: var\(--app-panel-radius\);/, 'with the same rounding as the content');
  assert.match(css, /\.coden-dashboard-shell \{[^}]*padding: var\(--app-gutter\);/,
    'and a gutter between them where the gradient shows');

  /*
   * One definition per theme, and none anywhere else.
   *
   * This used to insist on a single theme-independent mesh, from when the
   * sidebar sat on it and needed the ground to be the same in both. With the
   * sidebar an opaque panel that follows the theme, a per-theme mesh is the
   * coherent choice — a light page under a light panel. What must not happen
   * is the design system declaring a third copy on top of these, which is how
   * the two drifted the first time.
   */
  const meshes = (css.match(/--dashboard-ambient:/g) || []).length;
  assert.ok(meshes >= 1 && meshes <= 2, `the mesh is defined once per theme at most (${meshes})`);
  assert.doesNotMatch(horizon, /--dashboard-ambient:/, 'and the design system does not shadow it');

  /* A background nobody can see is a flat fill with extra steps. */
  for (const stops of css.match(/--dashboard-ambient:[\s\S]*?;\s*\n/g) || []) {
    assert.ok((stops.match(/gradient/g) || []).length >= 2, 'it is layered, not one wash');
  }
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

  /*
   * It still owns the palette — that is its job. The exact expression moved
   * from a color-mix to the canvas itself when the sidebar became a panel;
   * what matters is that the panel colour comes from the system's own tokens
   * rather than being written out again here.
   */
  assert.match(scoped, /--dashboard-panel: var\(--horizon-canvas\)|--dashboard-panel: color-mix\(in srgb, var\(--horizon-canvas\)/,
    'the panel still takes its colour from the system');

  /*
   * And the project card is out of the generic "every card is a surface"
   * list. That rule forced `background: var(--horizon-surface) !important`
   * and a 24px radius onto it, which put a solid box around a thumbnail and
   * its caption — the exact look the card is meant not to have.
   */
  const surfaces = horizon.slice(horizon.indexOf('.auth-card, .project-card'));
  // Prose stripped: the comment inside the block necessarily names the
  // selector it exists to explain the absence of.
  const selectors = surfaces.slice(0, surfaces.indexOf('}')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(selectors, /\.coden-dashboard-project-card\b/,
    'the project card is not forced to be an opaque surface');
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

/*
 * The sidebar's ink follows the theme, because its ground does again.
 *
 * When the sidebar rode directly on the mesh — deep blue in both themes — its
 * theme-dependent ink was near-black on saturated indigo in light mode, and it
 * had to be given a palette that ignored the theme. Making it an opaque panel
 * removes the cause rather than the symptom: the ground is light in the light
 * theme again, so the ordinary tokens are correct, and the dark theme gets its
 * own override.
 */
{
  const sidebar = block(css, '.coden-dashboard-sidebar');
  for (const token of ['--dashboard-text', '--dashboard-muted', '--dashboard-border', '--dashboard-surface']) {
    assert.match(sidebar, new RegExp(`${token}:`), `${token} is set for the sidebar`);
  }
  // Written as a literal rather than an escaped pattern: the light-theme
  // audit exempts the selector form [data-theme="dark"], and the
  // backslashes an escaped regex needs hide it from that exemption.
  assert.ok(css.includes('html[data-theme="dark"] .coden-dashboard-sidebar {'),
    'and the dark theme has its own values rather than inheriting light ones');

  // Light ink on a light panel, dark ink on a dark one: the pairing that broke.
  assert.match(sidebar, /--dashboard-text: #0f172a;/, 'dark ink on the light panel');
  const darkAt = css.indexOf('html[data-theme="dark"] .coden-dashboard-sidebar {');
  assert.ok(darkAt > 0, 'the dark override exists');
  assert.match(css.slice(darkAt, css.indexOf('}', darkAt)), /--dashboard-text: #f8fafc;/,
    'and light ink on the dark one');
}

/* The content sits in one rounded panel with a gutter around it. */
{
  const mainBlock = block(css, '.coden-dashboard-main');
  assert.match(mainBlock, /border-radius: var\(--app-panel-radius\);/, 'the panel has rounded edges');
  assert.match(mainBlock, /background: var\(--dashboard-panel\);/, 'and is the one opaque surface');
  assert.match(css, /\.coden-dashboard-shell \{[^}]*padding: var\(--app-gutter\);/,
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
  const titleBlock = block(css, '.coden-dashboard-section-title');
  assert.match(titleBlock, /clip-path: inset\(50%\);/, 'hidden from the eye');
  assert.doesNotMatch(titleBlock, /display: none/, 'but never from the accessibility tree');

  /*
   * Search and the tabs are one control. They narrow the same list, so two
   * adjacent bordered boxes read as two unrelated widgets; "Tout parcourir"
   * stays outside, because it leaves the list rather than narrowing it.
   */
  const toolbar = tsx.slice(tsx.indexOf('coden-dashboard-project-toolbar'), tsx.indexOf('coden-dashboard-project-list'));
  const controlsAt = toolbar.indexOf('coden-dashboard-project-controls');
  assert.ok(controlsAt > 0, 'the pill exists');
  assert.ok(controlsAt < toolbar.indexOf('coden-dashboard-search'), 'search is inside it');
  assert.ok(controlsAt < toolbar.indexOf('coden-dashboard-project-filters'), 'and so are the tabs');
  assert.ok(toolbar.indexOf('coden-dashboard-browse-all') > toolbar.indexOf('</div>'), 'browse-all is outside it');
  assert.match(css, /\.coden-dashboard-browse-all \{[^}]*margin-left: auto;/, 'pushed to the far right');
}

/*
 * A grid that hides projects says which filter is hiding them.
 *
 * Three things can drop a project out of this grid — a search, the seven-day
 * tab, and the six-tile cap — and all three leave the identical impression
 * that a project has gone missing. The note names the one that is doing it
 * and hands over the control that undoes it.
 */
{
  assert.match(tsx, /className="coden-dashboard-project-more"/, 'the grid explains what it is not showing');
  assert.match(tsx, /Vous cherchez un autre projet/, 'in the user\'s words');
  for (const cause of [
    /Il ne correspond pas à/,        // the query
    /que les sept derniers jours/,    // the tab
    /ne tiennent pas dans cette grille/, // the cap
  ]) {
    assert.match(tsx, cause, `one branch per cause: ${cause}`);
  }
  assert.match(tsx, /hiddenProjects\.onReveal/, 'and each hands back the control that undoes it');

  // Never shown when nothing is hidden — an explanation for an absence that
  // is not happening is just noise under every full grid.
  assert.match(tsx, /if \(projects\.length <= visibleProjects\.length\) return null;/,
    'and it is absent when the grid is complete');
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
  const badgeBlock = block(css, '.coden-dashboard-project-badge');
  assert.match(badgeBlock, /left: 9px;/, 'anchored to the left edge');
  assert.match(badgeBlock, /bottom: 9px;/, 'and to the bottom');
  assert.doesNotMatch(badgeBlock, /right:/, 'and not still pinned right as well');
  assert.match(badgeBlock, /background: rgba\(255, 255, 255, \.92\);/, 'a light pill');
  assert.match(badgeBlock, /border-radius: 999px;/, 'actually a pill');
  assert.match(badgeBlock, /z-index: 2;/, 'above the frame it labels');

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
 * The card is a picture with a caption, not a box.
 *
 * The rounded object is the thumbnail; the avatar and the name sit on the
 * panel beneath it with nothing drawn around them. An enclosing frame here
 * would turn a grid of previews into a grid of outlined rectangles, and the
 * preview — the only part with anything to look at — would lose the emphasis
 * it should be carrying.
 */
{
  const cardBlock = block(css, '.coden-dashboard-project-card');
  assert.match(cardBlock, /background: transparent;/, 'the card itself paints nothing');
  assert.match(cardBlock, /border: 0;/, 'and draws no frame');
  assert.doesNotMatch(cardBlock, /overflow: hidden;/, 'so it has nothing to clip');

  const previewBlock = block(css, '.coden-dashboard-project-preview');
  assert.match(previewBlock, /border-radius: 12px;/, 'the thumbnail is the rounded object');
  assert.match(previewBlock, /overflow: hidden;/, 'and clips the frame inside it');

  // The meta row has room for a 36px avatar beside the name.
  assert.match(css, /grid-template-columns: 36px minmax\(0, 1fr\) 17px;/, 'the caption is avatar, copy, chevron');
}

console.log('dashboard surface tests passed');
