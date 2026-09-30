/**
 * A real-browser rig for the streaming path.
 *
 * Serves a build of the builder over HTTP together with a mock API whose
 * generation endpoint streams server-sent events on a timer — progressively,
 * unlike a fulfilled route — and replays them from `Last-Event-ID`. Chromium
 * drives the real client against it, and each scenario measures what a person
 * would feel: time to the first words, evenness of the flow, raw markdown
 * flashing, a scroll that stays put, no text lost or repeated after a cut, a
 * reload, a stop.
 *
 *   VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=x vite build --outDir /tmp/audit-dist
 *   node scripts/stream-rig.mjs [scenario ...]
 */
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = process.env.RIG_DIST || '/tmp/audit-dist';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };

/** The reply: markdown with a list and a code fence, every slice carrying its own number. */
export function script({ slices = 60, sliceMs = 40, chars = 48, cutAfter = null, longCode = false, switchAt = null } = {}) {
  const body = [];
  const paragraph = 'Je crée la page **Commandes** avec un état vide, puis je vérifie le rendu sur mobile. ';
  for (let i = 0; i < slices; i += 1) {
    const marker = `⟦${String(i).padStart(3, '0')}⟧`;
    let piece = marker + paragraph.slice((i * 7) % 30, ((i * 7) % 30) + chars);
    if (i === 5) piece = `${marker}\n\n- Liste des commandes\n- État vide illustré\n\n\`\`\`tsx\nexport function Orders() {\n`;
    if (longCode && i > 5 && i < slices - 8) piece = `${marker}  const value${i} = compute(${i}, "${'x'.repeat(chars - 20)}");\n`;
    if (i === slices - 6) piece = `${marker}}\n\`\`\`\n\nEt voilà, la page est prête.\n\n`;
    body.push(piece);
  }
  return { body, sliceMs, cutAfter, switchAt };
}

export async function startRig() {
  const runs = new Map();
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) return api(req, res, url, p);
    let file = path.join(ROOT, p === '/' ? '/index.html' : p);
    if (!existsSync(file) || !path.extname(file)) file = existsSync(file + '.html') ? file + '.html' : path.join(ROOT, '404.html');
    res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  });

  const envelope = (run, channel, payload) => ({ runId: run.id, messageId: 'm1', seq: ++run.seq, timestamp: Date.now(), type: payload.type, channel, payload });
  function pushEvent(run, channel, payload) {
    const event = envelope(run, channel, payload);
    run.events.push(event);
    for (const client of run.clients) client.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
    return event;
  }
  function startRun(scriptDef) {
    const run = { startedAt: Date.now(), id: `run-${runs.size + 1}`, seq: 0, events: [], clients: new Set(), done: false, cancelled: false, script: scriptDef, cutTimes: 0 };
    runs.set(run.id, run);
    pushEvent(run, 'chat', { type: 'run_started', messageId: 'm1' });
    pushEvent(run, 'workspace', { type: 'run_acknowledged', threadId: 'thread-1', turnId: run.id, runId: run.id });
    pushEvent(run, 'chat', { type: 'activity', label: 'Coden construit l’application…' });
    let i = 0;
    run.timer = setInterval(() => {
      if (run.cancelled) return;
      if (i < scriptDef.body.length) {
        if (scriptDef.switchAt && i === scriptDef.switchAt) pushEvent(run, 'chat', { type: 'model_selected', modelId: 'openai/gpt-6-luna', label: 'Luna', reasoningLevel: 'high', reason: 'supervision', from: 'anthropic/claude-sonnet-5', fromLabel: 'Sonnet 5', detail: 'Le modèle précédent répétait la même erreur.' });
        pushEvent(run, 'chat', { type: 'text_delta', delta: scriptDef.body[i] });
        run.emitAt = run.emitAt || [];
        run.emitAt[i] = Date.now();
        i += 1;
        if (scriptDef.cutAfter && i === scriptDef.cutAfter && run.cutTimes === 0) { run.cutTimes += 1; for (const client of run.clients) client.destroy(); run.clients.clear(); }
        return;
      }
      clearInterval(run.timer);
      pushEvent(run, 'chat', { type: 'text_end' });
      pushEvent(run, 'workspace', { type: 'result', result: { success: true, files: [{ path: 'src/App.tsx', content: 'export default function App(){return <main>ok</main>}' }, { path: 'package.json', content: '{"name":"app"}' }], project: { id: PROJECT_ID, name: 'Boutique test', files: [{ path: 'src/App.tsx', content: 'export default function App(){return <main>ok</main>}' }] }, summary: 'Page créée.', assistant_streamed: true, preview: { status: 'idle' }, pipeline: 'multi_agent' } });
      pushEvent(run, 'chat', { type: 'run_finished', reason: 'completed' });
      run.done = true;
      run.finishedAt = Date.now();
      for (const client of run.clients) client.end();
      run.clients.clear();
    }, scriptDef.sliceMs);
    return run;
  }
  function attach(run, res, after) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no', 'x-coden-thread-id': 'thread-1', 'x-coden-turn-id': run.id });
    res.flushHeaders();
    for (const event of run.events) if (event.seq > after) res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
    if (run.done || run.cancelled) return res.end();
    run.clients.add(res);
    res.on('close', () => run.clients.delete(res));
  }
  let nextScript = script();
  const state = { setScript(s) { nextScript = s; }, runs, calls };

  async function api(req, res, url, p) {
    const json = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const project = { id: PROJECT_ID, name: 'Boutique test', files: [{ path: 'src/App.tsx', content: 'export default function App(){return null}' }], preview_status: 'idle' };
    if (p === `/api/projects/${PROJECT_ID}`) return json({ success: true, project, ...project });
    if (p.endsWith('/generate') && req.method === 'POST') {
      for await (const _ of req) { /* drain */ }
      const run = startRun(nextScript);
      calls.push(`POST generate -> ${run.id}`);
      return attach(run, res, 0);
    }
    const stream = p.match(/\/turns\/([^/]+)\/stream$/);
    if (stream) {
      const run = runs.get(stream[1]);
      calls.push(`GET stream ${stream[1]} after=${req.headers['last-event-id'] || 0}`);
      if (!run) return json({ success: false }, 404);
      return attach(run, res, Number(req.headers['last-event-id'] || 0));
    }
    if (p.endsWith('/agent/active-turn')) {
      const live = [...runs.values()].find(run => !run.done && !run.cancelled);
      return json({ success: true, active_turn: live ? { thread_id: 'thread-1', turn_id: live.id, prompt: 'Ajoute une page commandes', requested_mode: 'auto' } : null });
    }
    if (p.includes('/cancel')) {
      calls.push(`POST ${p.split('/').slice(-3).join('/')}`);
      const run = [...runs.values()].find(r => !r.done);
      if (run) { run.cancelled = true; clearInterval(run.timer); pushEvent(run, 'chat', { type: 'run_cancelled' }); for (const c of run.clients) c.end(); }
      return json({ success: true });
    }
    for await (const _ of req) { /* drain */ }
    return json({ success: true });
  }
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  state.base = `http://127.0.0.1:${server.address().port}`;
  state.close = () => { for (const run of runs.values()) { clearInterval(run.timer); for (const c of run.clients) c.destroy(); } server.close(); };
  return state;
}

const jwt = (() => { const b = o => Buffer.from(JSON.stringify(o)).toString('base64url'); return `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: '11111111-1111-4111-8111-111111111111', exp: 4102444800, role: 'authenticated', aud: 'authenticated' })}.sig`; })();
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'audit@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user };

/** Installs the in-page probes: growth of the reply, raw markdown showing, scroll position, long tasks. */
const PROBES = () => {
  window.__rig = { seenAt: {}, growth: [], flashes: 0, samples: 0, bottomGap: [], longTasks: [], submitAt: 0, firstTextAt: 0, renders: 0 };
  const reply = () => document.querySelector('.coden-agent-message');
  const scroller = () => { let el = reply(); while (el && el !== document.body) { const s = getComputedStyle(el); if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1) return el; el = el.parentElement; } return null; };
  const start = () => new MutationObserver(() => {
    const el = reply();
    if (!el) return;
    window.__rig.renders += 1;
    const length = el.innerText.length;
    const last = window.__rig.growth.at(-1);
    if (!last || last[1] !== length) window.__rig.growth.push([performance.now(), length]);
    if (!window.__rig.firstTextAt && /⟦000⟧|Je crée/.test(el.innerText)) window.__rig.firstTextAt = performance.now();
    for (const m of el.innerText.matchAll(/⟦(\d{3})⟧/g)) { const n = Number(m[1]); if (!(n in window.__rig.seenAt)) window.__rig.seenAt[n] = performance.timeOrigin + performance.now(); }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  setInterval(() => {
    const el = reply();
    if (!el) return;
    window.__rig.samples += 1;
    const text = el.innerText;
    // Raw markdown showing: a fence, or the asterisks of bold, while the reply is still being written.
    if (/```/.test(text)) window.__rig.flashes += 1;
    const sc = scroller();
    if (sc) { window.__rig.bottomGap.push(Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight)); (window.__rig.follow ||= []).push(sc.dataset.follow || 'unset'); }
  }, 25);
  try { new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__rig.longTasks.push(Math.round(entry.duration)); }).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ }
};

export async function openBuilder(rig, { viewport = { width: 1280, height: 800 }, mobile = false, cdp = null } = {}) {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/opt/pw-browsers/chromium', args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await context.addInitScript(([s]) => { localStorage.setItem('coden.auth.session.v2', JSON.stringify(s)); }, [session]);
  await context.addInitScript(PROBES);
  const page = await context.newPage();
  await page.route('https://mock.supabase.co/**', route => {
    const url = route.request().url();
    if (url.includes('/auth/v1/user')) return route.fulfill({ json: user });
    if (url.includes('/auth/v1/token')) return route.fulfill({ json: session });
    return route.fulfill({ json: [] });
  });
  const errors = [];
  page.on('pageerror', e => { if (!/localStorage/.test(e.message)) errors.push(e.message.slice(0, 160)); });
  await page.goto(`${rig.base}/builder.html?project=${PROJECT_ID}`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  if (cdp) { const session = await context.newCDPSession(page); await cdp(session); }
  return { browser, context, page, errors };
}

export async function send(page, text = 'Ajoute une page commandes') {
  await page.getByPlaceholder(/Demandez à Coden/).first().fill(text);
  await page.evaluate(() => { window.__rig.submitAt = performance.now(); });
  await page.keyboard.press('Enter');
}

export function evenness(growth, minMs = 400) {
  // The gaps between visible growth: a stream that stutters has a few long ones.
  const gaps = growth.slice(1).map((point, index) => point[0] - growth[index][0]);
  const sorted = [...gaps].sort((a, b) => a - b);
  return { updates: growth.length, p50Gap: Math.round(sorted[Math.floor(sorted.length / 2)] || 0), p95Gap: Math.round(sorted[Math.floor(sorted.length * 0.95)] || 0), maxGap: Math.round(sorted.at(-1) || 0), stalls: gaps.filter(gap => gap > minMs).length };
}

export const markers = text => [...text.matchAll(/⟦(\d{3})⟧/g)].map(match => Number(match[1]));
export function integrity(found, expected) {
  const seen = new Set(found);
  const missing = Array.from({ length: expected }, (_, i) => i).filter(i => !seen.has(i));
  return { expected, found: found.length, missing: missing.length ? `${missing.length} (${missing.slice(0, 6).join(',')}…)` : 0, duplicated: found.length - seen.size, inOrder: found.every((value, index) => index === 0 || value >= found[index - 1]) };
}

/** How far behind the server the screen is, per slice: when it showed slice n minus when the server sent it. */
export function lag(run, seenAt) {
  const lags = [];
  (run.emitAt || []).forEach((sent, n) => { if (n in seenAt) lags.push(Math.round(seenAt[n] - sent)); });
  const sorted = [...lags].sort((a, b) => a - b);
  return { slices: lags.length, p50Ms: sorted[Math.floor(sorted.length / 2)] ?? null, p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? null, maxMs: sorted.at(-1) ?? null };
}
