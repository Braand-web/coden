import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The Publish panel's custom-domain screen.
 *
 * It used to be a dead end: one sentence telling the user to "connect a custom
 * domain from project settings" and a button that opened the settings page,
 * where nothing handled domains either. The routes behind it answered
 * "Vercel domain operations are not configured" on every request.
 *
 * These assertions pin the screen to the working Cloudflare routes, because a
 * panel that renders is not the same as a panel that does anything.
 */
const builder = readFileSync('src/builder-live.ts', 'utf8');
const css = readFileSync('src/styles/publish-panel.css', 'utf8');
const server = readFileSync('server.ts', 'utf8');

// Every operation the interface offers reaches a route that exists.
for (const [label, call, route] of [
  ['list', /\/domains`\)/, "app.get('/api/projects/:id/domains'"],
  ['add', /\/domains`, \{\s*method: 'POST'/, "app.post('/api/projects/:id/domains'"],
  ['verify', /\$\{base\}\/verify`, \{ method: 'POST' \}/, "app.post('/api/projects/:id/domains/:domainId/verify'"],
  ['remove', /apiFetch\(base, \{ method: 'DELETE' \}\)/, "app.delete('/api/projects/:id/domains/:domainId'"],
  ['primary', /\$\{base\}\/primary`, \{ method: 'PATCH' \}/, "app.patch('/api/projects/:id/domains/:domainId/primary'"],
] as const) {
  assert.ok((call as RegExp).test(builder), `the panel must call the ${label} endpoint`);
  assert.ok(server.includes(route as string), `the ${label} route must exist on the server`);
}

// The five states are shown by name, and each tells the user what to do next.
for (const state of ['configuration_required', 'dns_verification', 'dns_propagation', 'active', 'error']) {
  assert.ok(builder.includes(state), `the panel must handle the "${state}" state`);
  assert.ok(css.includes(`[data-state="${state}"]`), `"${state}" needs its own visual treatment`);
  assert.ok(
    new RegExp(`${state}:\\s*'[^']{12,}'`).test(builder),
    `"${state}" must tell the user what to do next`,
  );
}

// State is carried by shape as well as colour, so it survives a colour-blind
// reader and a monochrome screenshot.
assert.ok(/\.cdn-dom__state::before[\s\S]{0,200}border-radius/.test(css), 'the state chip needs a shape marker');
assert.ok(
  /\[data-state="dns_propagation"\]::before[\s\S]{0,120}border-radius/.test(css)
  && /\[data-state="configuration_required"\]::before[\s\S]{0,160}box-shadow/.test(css),
  'states must differ by shape, not only by colour',
);

// The server hands the interface one resolved state, so the panel never has to
// interpret a status column or a provider string.
assert.ok(/state,\s*state_label: domainStateLabel/.test(server), 'the list route must resolve the state server-side');

// The old dead end must not come back.
assert.ok(!/Connect a custom domain from project settings/i.test(builder), 'the panel must not send the user elsewhere');
assert.ok(!/vercel/i.test(builder.slice(builder.indexOf('function renderDomainSection'), builder.indexOf('function renderPublishPanel'))));

// Styling left the template. The panel was ~140 inline declarations re-emitted
// on every render; a rule that lives here can be themed and read.
const panelStart = builder.indexOf('function renderPublishPanel');
const panelEnd = builder.indexOf('async function openPublishPanel');
const panelSource = builder.slice(panelStart, panelEnd);
const inlineStyles = (panelSource.match(/style="[^"]{40,}"/g) || []).length;
assert.ok(inlineStyles <= 2, `the panel should carry class names, not inline styles (found ${inlineStyles} long ones)`);
assert.ok(css.includes('.cdn-pub {'), 'the panel stylesheet must define the panel');
assert.ok(builder.includes("import './styles/publish-panel.css'"), 'the stylesheet must be loaded');

// Motion is opt-out for readers who ask for less of it.
assert.ok(/prefers-reduced-motion[\s\S]{0,120}animation: none/.test(css), 'the panel entrance must respect reduced motion');

// A field the user types into needs a visible focus state.
assert.ok(/\.cdn-dom__input:focus-visible/.test(css), 'the domain field needs a visible focus ring');

// Actions in flight are announced and cannot be fired twice.
assert.ok(/domainBusy === `verify:\$\{domain\.id\}`/.test(builder), 'verification must show as in flight');
assert.ok(/\$\{verifying \? 'disabled' : ''\}/.test(builder), 'an in-flight action must not be clickable again');

// The compact summary counts only findings that need attention. Production
// previously displayed "À revoir 5" for three passing checks and two notes.
assert.ok(/const issueCount = failCount \+ warnCount/.test(builder), 'the summary count must represent actual issues');
assert.ok(/const visibleCheckCount = issueCount \|\| passCount/.test(builder), 'a clean result may show its passed-check count');
assert.ok(!builder.includes("return 'Ready to publish'"), 'the French Builder must not switch to English in this panel');

// The panel never guesses the outcome — it re-reads the list the server owns.
assert.ok(/await loadProjectDomains\(\);\s*\n\s*renderPublishPanel/.test(builder), 'the list must be re-read after every action');

console.log('publish domains UI tests passed');
