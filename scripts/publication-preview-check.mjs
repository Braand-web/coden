import { chromium, request as playwrightRequest } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:4181';
const directory = new URL('../artifacts/publication-v2-preview/', import.meta.url);
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/Braand/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' });
const report = [];
try {
  for (const scenario of (process.argv.includes('--functional-only') ? [] : [{ name: 'desktop-dark', width: 1365, height: 900, theme: 'dark', motion: 'no-preference' }, { name: 'desktop-light', width: 1365, height: 900, theme: 'light', motion: 'no-preference' }, { name: 'mobile-dark', width: 390, height: 844, theme: 'dark', motion: 'reduce' }, { name: 'mobile-light', width: 390, height: 844, theme: 'light', motion: 'reduce' }])) {
    const page = await browser.newPage({ viewport: { width: scenario.width, height: scenario.height }, reducedMotion: scenario.motion });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.waitForLoadState('networkidle');
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, scenario.theme);
    await page.getByRole('button', { name: 'Publier', exact: true }).click();
    await page.getByText('Chargement de la publication…', { exact: false }).waitFor({ state: 'hidden' });
    await page.waitForTimeout(200);
    const geometry = await page.locator('dialog').evaluate(dialog => ({ font: getComputedStyle(dialog).fontFamily, fontVariable: getComputedStyle(dialog).getPropertyValue('--font-sans'), rect: dialog.getBoundingClientRect().toJSON(), scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth, animation: getComputedStyle(dialog).animationName }));
    assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, 'No horizontal overflow');
    assert.ok(geometry.rect.x >= 0 && geometry.rect.right <= scenario.width, 'Dialog inside viewport');
    if (scenario.motion === 'reduce') assert.equal(geometry.animation, 'none');
    await page.screenshot({ path: new URL(`${scenario.name}.png`, directory).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#publish').evaluate(button => button === document.activeElement), true);
    report.push({ scenario: scenario.name, geometry, errors });
    await page.close();
  }
  // One real fixture flow through SQL + durable queue, not mocked HTTP replies.
  const page = await browser.newPage();
  const publishEndpoint = `${base}/api/projects/10000000-0000-4000-8000-000000000001/publish`;
  const initial = (await (await page.request.get(`${publishEndpoint}/status`)).json()).publish;
  const prepared = await page.request.put(`${publishEndpoint}/settings`, { data: { ...initial.draft, subdomain: 'chez-marcel-10000000', audience: 'public', invitations: [] } });
  assert.equal(prepared.status(), 200);
  await page.goto(base); await page.getByRole('button', { name: 'Publier', exact: true }).click();
  await page.locator('[data-action="publish"]').waitFor({ state: 'visible' });
  const launched = page.waitForResponse(response => response.url().endsWith('/publish') && response.request().method() === 'POST');
  await page.locator('[data-action="publish"]').click();
  const launchResponse = await launched;
  assert.equal(launchResponse.status(), 202);
  const jobId = (await launchResponse.json()).job_id;
  let completed = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    const job = (await (await page.request.get(`${base}/api/jobs/${jobId}`)).json()).job;
    if (job.status === 'failed') throw new Error('Simulated publication job failed');
    if (job.status === 'completed') { completed = true; break; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(completed, 'Durable publication completed');
  const state = (await (await page.request.get(`${base}/api/projects/10000000-0000-4000-8000-000000000001/publish/status`)).json()).publish;
  assert.equal(state.active_job, null);
  assert.equal((await page.request.get(state.public_url)).status(), 200);
  await page.reload(); await page.getByRole('button', { name: 'Publier', exact: true }).click();
  await page.locator('[data-action="copy"]').waitFor();
  report.push({ scenario: 'publish-reload-open', publicUrl: state.public_url, passed: true });
  const api = async (method, path, body) => {
    const response = await page.request.fetch(base + path, { method, ...(body ? { data: body } : {}) });
    assert.ok(response.ok(), `${method} ${path}: ${response.status()}`);
    return response.json();
  };
  const endpoint = '/api/projects/10000000-0000-4000-8000-000000000001/publish';
  const waitJob = async id => { for (let attempt = 0; attempt < 150; attempt++) { const job = (await (await page.request.get(`${base}/api/jobs/${id}`)).json()).job; if (job.status === 'completed') return; if (job.status === 'failed') throw new Error('Simulated job failed'); await new Promise(resolve => setTimeout(resolve, 200)); } throw new Error('Job timeout'); };
  const draft = { ...state.draft, subdomain: 'marcel-local-prive', audience: 'invite_only', invitations: ['invite@example.test'], metadata: { ...state.draft.metadata, title: 'Chez Marcel privé', description: 'Accès sur invitation' } };
  const saved = await api('PUT', `${endpoint}/settings`, draft);
  assert.equal(saved.publish.effective.audience, 'public', 'Draft does not change effective access');
  const privateJob = await api('POST', endpoint, { async: true, confirmed: true, idempotency_key: `local-private-${Date.now()}` });
  await waitJob(privateJob.job_id);
  const privateState = (await api('GET', `${endpoint}/status`)).publish;
  const outsider = await playwrightRequest.newContext();
  const invited = await playwrightRequest.newContext();
  try {
    assert.equal((await outsider.get(privateState.public_url)).status(), 401);
    assert.equal((await outsider.get(privateState.public_url + 'assets/app.js')).status(), 401);
    assert.equal((await outsider.get(state.public_url)).status(), 401, 'Old alias cannot bypass private mode');
    assert.equal((await outsider.get(`${base}/preview/identity/stranger`)).status(), 403);
    assert.equal((await invited.get(`${base}/preview/identity/guest`)).status(), 200);
    const privatePage = await invited.get(privateState.public_url);
    assert.equal(privatePage.status(), 200); assert.match(await privatePage.text(), /<title>Chez Marcel privé<\/title>/);
    await api('PUT', `${endpoint}/settings`, { ...draft, invitations: [] });
    await waitJob((await api('POST', endpoint, { async: true, confirmed: true, idempotency_key: `local-revoke-${Date.now()}` })).job_id);
    assert.equal((await invited.get(privateState.public_url)).status(), 401, 'Removed invitation invalidates existing session');
    const controller = new AbortController();
    const events = await fetch(`${base}/api/jobs/${privateJob.job_id}/events`, { headers: { 'Last-Event-ID': '1' }, signal: controller.signal });
    const chunk = await events.body.getReader().read(); controller.abort();
    const ids = [...new TextDecoder().decode(chunk.value).matchAll(/^id: (\d+)$/gm)].map(match => Number(match[1]));
    assert.ok(ids.length && ids.every(id => id > 1), 'SSE resumes after ordered sequence');
    await api('DELETE', endpoint);
    assert.equal((await outsider.get(privateState.public_url)).status(), 401);
    assert.equal((await api('GET', `${endpoint}/status`)).publish.public_url, null);
    report.push({ scenario: 'private-rename-metadata-invitation-revocation-sse-unpublish', passed: true });
  } finally { await outsider.dispose(); await invited.dispose(); }
  await page.close();
  console.log(JSON.stringify(report, null, 2));
  await fs.writeFile(new URL(process.argv.includes('--functional-only') ? 'functional-check.json' : 'visual-check.json', directory), JSON.stringify(report, null, 2));
} finally { await browser.close(); }
