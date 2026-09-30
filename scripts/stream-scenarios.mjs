import { evenness, integrity, lag, markers, openBuilder, script, send, startRig } from './stream-rig.mjs';

const wanted = process.argv.slice(2);
const results = {};
const only = name => !wanted.length || wanted.includes(name);
const rig = await startRig();

async function finished(page, timeout = 30_000) {
  await page.waitForFunction(() => { const m = document.querySelector('.coden-agent-message'); return m && m.getAttribute('data-status') !== 'streaming'; }, null, { timeout }).catch(() => undefined);
}
const replyText = page => page.evaluate(() => document.querySelector('.coden-agent-message')?.innerText || '');

try {
  if (only('baseline')) {
    rig.setScript(script({ slices: 60, sliceMs: 40 }));
    const { browser, page, errors } = await openBuilder(rig);
    await send(page);
    await finished(page);
    const clientDoneAt = Date.now();
    const probe = await page.evaluate(() => window.__rig);
    const text = await replyText(page);
    const run = [...rig.runs.values()].at(-1);
    results.baseline = {
      serverStreamMs: run.finishedAt - run.startedAt, clientCaughtUpAfterServerMs: clientDoneAt - run.finishedAt, behindServer: lag(run, probe.seenAt),
      timeToFirstTextMs: Math.round(probe.firstTextAt - probe.submitAt), ...evenness(probe.growth), flashes: probe.flashes, samples: probe.samples,
      longTasks: probe.longTasks, integrity: integrity(markers(text), 60), errors,
      maxBottomGap: Math.max(0, ...probe.bottomGap),
    };
    await browser.close();
  }

  if (only('realistic')) {
    // What a provider actually does: ~75 tokens a second, delivered in small clumps.
    rig.setScript(script({ slices: 60, sliceMs: 80, chars: 24 }));
    const { browser, page, errors } = await openBuilder(rig);
    await send(page);
    await finished(page);
    const clientDoneAt = Date.now();
    const probe = await page.evaluate(() => window.__rig);
    const run = [...rig.runs.values()].at(-1);
    results.realistic = { serverStreamMs: run.finishedAt - run.startedAt, clientCaughtUpAfterServerMs: clientDoneAt - run.finishedAt, behindServer: lag(run, probe.seenAt), timeToFirstTextMs: Math.round(probe.firstTextAt - probe.submitAt), ...evenness(probe.growth), flashes: probe.flashes, errors };
    await browser.close();
  }

  if (only('long')) {
    rig.setScript(script({ slices: 700, sliceMs: 15, chars: 80, longCode: true }));
    const { browser, page, errors } = await openBuilder(rig);
    await send(page);
    await finished(page, 60_000);
    const probe = await page.evaluate(() => window.__rig);
    const text = await replyText(page);
    results.long = { chars: text.length, ...evenness(probe.growth, 250), flashes: probe.flashes, longTasks: probe.longTasks.length ? { count: probe.longTasks.length, maxMs: Math.max(...probe.longTasks) } : { count: 0, maxMs: 0 }, integrity: integrity(markers(text), 700), maxBottomGap: Math.max(0, ...probe.bottomGap), gapDuringStream: Math.max(0, ...probe.bottomGap.slice(0, Math.floor(probe.bottomGap.length * 0.8))), gapAtTheEnd: probe.bottomGap.slice(-6), firstDetachAtSample: (probe.follow || []).indexOf('off'), samples: probe.bottomGap.length, errors };
    await browser.close();
  }

  if (only('cut')) {
    rig.setScript(script({ slices: 60, sliceMs: 40, cutAfter: 25 }));
    const { browser, page, errors } = await openBuilder(rig);
    await send(page);
    await finished(page, 40_000);
    const text = await replyText(page);
    results.cut = { integrity: integrity(markers(text), 60), calls: rig.calls.slice(-4), status: await page.evaluate(() => document.querySelector('.coden-agent-message')?.getAttribute('data-status')), errors };
    await browser.close();
  }

  if (only('reload')) {
    rig.setScript(script({ slices: 90, sliceMs: 60 }));
    const { browser, page, errors } = await openBuilder(rig);
    await send(page);
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(3000);
    await finished(page, 40_000);
    const text = await replyText(page);
    results.reload = { integrity: integrity(markers(text), 90), calls: rig.calls.slice(-4), status: await page.evaluate(() => document.querySelector('.coden-agent-message')?.getAttribute('data-status')), errors };
    await browser.close();
  }

  if (only('stop')) {
    rig.setScript(script({ slices: 200, sliceMs: 60 }));
    const { browser, page, errors } = await openBuilder(rig);
    const before = rig.calls.length;
    await send(page);
    await page.waitForTimeout(1500);
    const stop = page.locator('#btn-live-cancel, [aria-label*="Arrêter"], [aria-label*="Stop"], button:has-text("Arrêter")').first();
    const visible = await stop.isVisible().catch(() => false);
    if (visible) await stop.click().catch(() => undefined);
    await page.waitForTimeout(1500);
    const run = [...rig.runs.values()].at(-1);
    const seqAtStop = run.events.length;
    await page.waitForTimeout(1500);
    results.stop = { stopButtonFound: visible, serverCancelCalls: rig.calls.slice(before).filter(call => call.includes('cancel')), serverRunCancelled: run.cancelled, eventsAfterStop: run.events.length - seqAtStop, status: await page.evaluate(() => document.querySelector('.coden-agent-message')?.getAttribute('data-status')), errors };
    await browser.close();
  }

  if (only('slow-mobile')) {
    rig.setScript(script({ slices: 80, sliceMs: 40 }));
    const { browser, page, errors } = await openBuilder(rig, { viewport: { width: 390, height: 844 }, mobile: true, cdp: async session => {
      await session.send('Network.enable');
      await session.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 20 * 1024 });
      await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    } });
    await send(page);
    await finished(page, 60_000);
    const probe = await page.evaluate(() => window.__rig);
    const text = await replyText(page);
    results['slow-mobile'] = { timeToFirstTextMs: Math.round(probe.firstTextAt - probe.submitAt), ...evenness(probe.growth, 600), flashes: probe.flashes, integrity: integrity(markers(text), 80), longTasks: probe.longTasks.length ? { count: probe.longTasks.length, maxMs: Math.max(...probe.longTasks) } : { count: 0, maxMs: 0 }, errors };
    await browser.close();
  }

  if (only('background')) {
    rig.setScript(script({ slices: 80, sliceMs: 50 }));
    const { browser, page, context, errors } = await openBuilder(rig);
    await send(page);
    await page.waitForTimeout(800);
    // A second tab in front hides the first: timers and animation frames are throttled there.
    const other = await context.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    await page.waitForTimeout(3500);
    await page.bringToFront();
    await finished(page, 30_000);
    const text = await replyText(page);
    results.background = { integrity: integrity(markers(text), 80), status: await page.evaluate(() => document.querySelector('.coden-agent-message')?.getAttribute('data-status')), errors };
    await browser.close();
  }

  if (only('model-switch')) {
    rig.setScript(script({ slices: 60, sliceMs: 40, switchAt: 30 }));
    const { browser, page, errors } = await openBuilder(rig);
    await send(page);
    await page.locator('.coden-agent-auto-choice').first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => undefined);
    await finished(page);
    const text = await replyText(page);
    results['model-switch'] = { integrity: integrity(markers(text), 60), switchLineShown: /a changé de modèle/.test(text), textIntactAcrossSwitch: !integrity(markers(text), 60).missing, errors };
    await browser.close();
  }

  if (only('scroll')) {
    rig.setScript(script({ slices: 160, sliceMs: 25, chars: 80, longCode: true }));
    const { browser, page, errors } = await openBuilder(rig, { viewport: { width: 1280, height: 520 } });
    await send(page);
    await page.waitForTimeout(1800);
    const stuck = await page.evaluate(() => Math.max(0, ...window.__rig.bottomGap.slice(-20)));
    // The person scrolls up to re-read: the flow must not drag them back down.
    // The wheel goes where the reader's pointer is: inside the conversation's own scroll area.
    const box = await page.evaluate(() => { let s = document.querySelector('.coden-agent-message'); while (s && s !== document.body) { const st = getComputedStyle(s); if (/(auto|scroll)/.test(st.overflowY) && s.scrollHeight > s.clientHeight + 1) { const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; } s = s.parentElement; } return null; });
    if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -800); }
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => { const el = document.querySelector('.coden-agent-message'); let s = el; while (s && s !== document.body) { const st = getComputedStyle(s); if (/(auto|scroll)/.test(st.overflowY) && s.scrollHeight > s.clientHeight + 1) return { top: s.scrollTop, gap: s.scrollHeight - s.scrollTop - s.clientHeight }; s = s.parentElement; } return null; });
    await page.waitForTimeout(1500);
    const later = await page.evaluate(() => { const el = document.querySelector('.coden-agent-message'); let s = el; while (s && s !== document.body) { const st = getComputedStyle(s); if (/(auto|scroll)/.test(st.overflowY) && s.scrollHeight > s.clientHeight + 1) return { top: s.scrollTop, gap: s.scrollHeight - s.scrollTop - s.clientHeight }; s = s.parentElement; } return null; });
    results.scroll = { gapWhileFollowingPx: stuck, afterScrollUp: after, oneAndAHalfSecondsLater: later, draggedBack: Boolean(after && later && later.top > after.top + 40), errors };
    await browser.close();
  }
} finally {
  rig.close();
}
console.log(JSON.stringify(results, null, 2));
