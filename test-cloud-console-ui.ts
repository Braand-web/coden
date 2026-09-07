import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('builder.html', 'utf8');
const builder = readFileSync('src/builder-live.ts', 'utf8');
const css = readFileSync('src/styles/cloud-console.css', 'utf8');

assert.equal((html.match(/id="screen-layout-database"/g) || []).length, 1, 'the workspace must contain exactly one Cloud panel');
assert.equal((html.match(/id="database-content"/g) || []).length, 1, 'the Cloud console must have one render root');
assert.ok(!html.includes('Cloud & base de données'), 'the retired monolithic Cloud heading must not be rendered');
assert.ok(html.includes(':not(#tab-btn-database)'), 'Cloud must remain accessible before the first generated file');
assert.ok(!builder.includes("panel.innerHTML = `\n    <div style=\"display:grid;gap:14px"), 'the old fallback panel must not return');
assert.ok(builder.includes("databaseBtn.innerHTML = '<span aria-hidden=\"true\" style=\"font-size:13px;\">☁</span> Cloud'"));

for (const view of ['overview', 'database', 'users', 'storage', 'emails', 'secrets', 'jobs', 'functions', 'logs', 'usage', 'analytics', 'advanced']) {
  assert.match(builder, new RegExp(`id: '${view}'`), `Cloud navigation must include ${view}`);
}

for (const endpoint of ['/database`', '/workflows`', '/ai-usage', '/analysis?range=']) {
  assert.ok(builder.includes(endpoint), `the console must use the real ${endpoint} route`);
}

assert.ok(builder.includes('loadProjectDbBrowser()'), 'Database must hydrate from the table browser API');
assert.ok(builder.includes('loadProjectEndUsers()'), 'Users must hydrate from the Auth users API');
assert.ok(builder.includes('bindProjectStorageHandlers()'), 'Storage must keep real upload and delete actions');
assert.ok(builder.includes("import './styles/cloud-console.css'"), 'the Cloud design system must be loaded');
assert.ok(css.includes('.cloud-console-nav-item.is-active'), 'the current Cloud destination needs a visible state');
assert.ok(css.includes('@media (max-width: 720px)'), 'the console must adapt to narrow workspaces');
assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'Cloud motion must respect user preferences');
assert.ok(!/linear-gradient|radial-gradient/.test(css), 'the Cloud console must keep the flat Coden visual language');

console.log('test-cloud-console-ui passed');
