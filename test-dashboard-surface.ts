import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./src/styles/dashboard-react.css', import.meta.url), 'utf8');
const horizon = readFileSync(new URL('./src/styles/coden-horizon-system.css', import.meta.url), 'utf8');
const tsx = readFileSync(new URL('./src/dashboard-react.tsx', import.meta.url), 'utf8');

function block(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = source.search(new RegExp(`^${escaped}\\s*\\{`, 'm'));
  assert.ok(start >= 0, `the rule for ${selector} exists`);
  const end = source.indexOf('}', start);
  assert.ok(end > start, `the rule for ${selector} is complete`);
  return source.slice(start, end);
}

/* The current dashboard is the floating composition from the approved
   reference: a global atmosphere, a transparent sidebar, and one workspace
   panel. The stylesheet owns layout; the shared horizon layer must not flatten
   any of those three layers afterwards. */
const bodyStart = css.indexOf('body:has(#coden-dashboard-react-root)', css.indexOf('body:has(#coden-dashboard-react-root)') + 1);
assert.ok(bodyStart >= 0, 'the dashboard body rule exists');
const body = css.slice(bodyStart, css.indexOf('}', bodyStart));
assert.match(body, /background: var\(--background\);/);
assert.match(body, /background-image: url\('\/dashboard-ambient-light\.svg'\);/);
assert.match(css, /html\[data-theme="dark"\] body:has\(#coden-dashboard-react-root\)/);
assert.match(css, /background-image: url\('\/dashboard-ambient-dark\.svg'\);/);

const shell = block(css, '.coden-dashboard-shell');
assert.match(shell, /padding: var\(--app-gutter\);/);
assert.match(shell, /gap: var\(--app-gutter\);/);
assert.match(shell, /background: transparent;/);

const sidebar = block(css, '.coden-dashboard-sidebar');
assert.match(sidebar, /background: transparent;/);
assert.match(sidebar, /border: 0;/);
assert.match(sidebar, /border-radius: 0;/);

const main = block(css, '.coden-dashboard-main');
assert.match(main, /background: var\(--surface\);/);
assert.match(main, /border: 1px solid var\(--border\);/);
assert.match(main, /border-radius: var\(--app-panel-radius\);/);
assert.match(main, /box-shadow: var\(--shadow-lg\);/);

assert.match(horizon, /background-image: url\('\/dashboard-ambient-light\.svg'\) !important;/);
assert.match(horizon, /html\[data-theme="dark"\] body:has\(#coden-dashboard-react-root\)/);
assert.match(horizon, /\.coden-dashboard-sidebar \{\s*background: transparent !important;\s*border: 0 !important;/);
assert.doesNotMatch(horizon, /body:has\(#coden-dashboard-react-root\)[\s\S]{0,180}background-image: none !important/);

/* The exact product palette remains in the token file. Dashboard CSS uses
   semantic tokens and image assets for the requested global atmosphere, never
   a second palette or a CSS gradient literal. */
assert.doesNotMatch(css, /(?:linear|radial|conic)-gradient\(/);
assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
assert.doesNotMatch(css, /var\(--dashboard-(?:text|muted|surface|raised|border|focus)\)/);

/* The layout and real project workflow stay intact. */
assert.match(tsx, /<PromptInput/);
assert.match(tsx, /apiFetch<ProjectsResponse>\('\/api\/projects'\)/);
assert.match(tsx, /startCreateProjectFlow/);
assert.match(tsx, /preview_html/);
assert.match(tsx, /sandbox="allow-scripts"/);
assert.match(tsx, /className="coden-dashboard-project-list coden-enter-stagger"/);
assert.match(tsx, /className="coden-dashboard-project-card"/);
assert.match(tsx, /aria-label="Fermer le menu"/);

/* On phones the panel becomes the screen and the drawer gets its own solid
   surface, preventing the global art from reducing readability. */
const mobile = css.slice(css.indexOf('@media (max-width: 767px)'));
assert.match(mobile, /\.coden-dashboard-shell \{\s*padding: 0;/);
assert.match(mobile, /\.coden-dashboard-main \{\s*border: 0;\s*border-radius: 0;/);
assert.match(mobile, /background: var\(--sidebar\);/);

console.log('dashboard surface tests passed');
