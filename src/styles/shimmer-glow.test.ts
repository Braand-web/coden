import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';

/**
 * The shimmer glow, in a real Chromium: it fades in, breathes on the compositor-only properties, pauses, goes
 * off with its switch, and stays still under « reduce motion ». Skipped where no browser can be launched.
 */
const tokens = readFileSync('src/styles/coden-tokens.css', 'utf8');
const shimmer = readFileSync('src/components/ui/shimmering-text.css', 'utf8');
const glow = readFileSync('src/styles/shimmer-glow.css', 'utf8');
const page = (theme: 'light' | 'dark', extraRoot = '') => `<!doctype html><html data-theme="${theme}" ${extraRoot}><head><meta charset="utf-8"><style>${tokens}\n${shimmer}\n${glow}\nbody{margin:0;padding:48px;background:var(--background);color:var(--text-strong);font:16px system-ui}.row{margin:28px 0}.coden-skeleton{display:block;width:260px;height:14px}</style></head><body><div class="row"><span class="coden-shimmer-text" id="t">Coden réfléchit…</span></div><div class="row"><span class="coden-skeleton" id="s"></span></div></body></html>`;
const shots = process.env.SHIMMER_SHOTS_DIR;

let browser: Browser | undefined;
beforeAll(async () => {
  for (const executablePath of [undefined, process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, '/opt/pw-browsers/chromium'].filter((value, index) => index === 0 || (value && existsSync(value)))) {
    try { browser = await chromium.launch({ headless: true, timeout: 15_000, args: ['--disable-dev-shm-usage'], ...(executablePath ? { executablePath } : {}) }); break; } catch { browser = undefined; }
  }
}, 30_000);
afterAll(async () => { await browser?.close(); });

const open = async (html: string, options: Parameters<Browser['newContext']>[0] = {}) => {
  const context = await browser!.newContext({ viewport: { width: 600, height: 240 }, ...options });
  const tab = await context.newPage();
  await tab.setContent(html);
  return { tab, context };
};
const beforeStyle = (tab: import('playwright').Page, selector: string) => tab.evaluate(sel => {
  const style = getComputedStyle(document.querySelector(sel)!, '::before');
  return { content: style.content, opacity: Number(style.opacity), animation: style.animationName, pointer: style.pointerEvents, position: style.position, filter: style.filter, zIndex: style.zIndex, state: style.animationPlayState, scale: style.scale, translate: style.translate };
}, selector);

describe('the stylesheet', () => {
  it('animates only opacity, scale and translate — no box-shadow, no filter, no size, no colour', () => {
    const frames: string[] = [];
    for (const match of glow.matchAll(/@keyframes coden-glow-[\w-]+\s*\{/g)) {
      let depth = 1; let index = (match.index ?? 0) + match[0].length; const start = index;
      while (depth && index < glow.length) { if (glow[index] === '{') depth += 1; else if (glow[index] === '}') depth -= 1; index += 1; }
      frames.push(glow.slice(start, index - 1));
    }
    expect(frames.length).toBe(2);
    for (const body of frames) {
      const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map(match => match[1]);
      for (const property of properties) expect(['opacity', 'scale', 'translate']).toContain(property);
    }
  });

  it('has a token in both themes, a reduced-motion rule, and stays inert', () => {
    expect(tokens.match(/--glow-blue:/g)).toHaveLength(2);
    expect(glow).toMatch(/prefers-reduced-motion: reduce/);
    expect(glow).toMatch(/pointer-events: none/);
    expect(glow).toMatch(/260ms/);
    expect(glow).not.toMatch(/inset: -(?:[6-9]|\d{2,})px/);
    expect(glow).not.toMatch(/#[0-9a-fA-F]{3,8}\b|violet|purple|indigo/i);
  });

  it('breathes slower than three pulses a second', () => {
    const seconds = [...glow.matchAll(/coden-glow-breathe ([\d.]+)s/g)].map(match => Number(match[1]));
    expect(seconds.length).toBeGreaterThan(0);
    for (const value of seconds) expect(1 / value).toBeLessThan(3);
  });
});

describe('in a browser', () => {
  it('the text carries its light on its own letters: a short drop-shadow, no halo layer', async (context) => {
    if (!browser) return context.skip();
    for (const theme of ['light', 'dark'] as const) {
      const { tab, context: ctx } = await open(page(theme));
      const text = await tab.evaluate(() => { const element = document.querySelector('#t')!; const style = getComputedStyle(element); return { filter: style.filter, before: getComputedStyle(element, '::before').content, width: element.getBoundingClientRect().width }; });
      await ctx.close();
      expect(text.before).toBe('none');
      expect(text.filter).toMatch(/drop-shadow/);
      // Every radius stays within a few pixels of the letters.
      const radii = [...text.filter.matchAll(/(\d+(?:\.\d+)?)px\)/g)].map(match => Number(match[1]));
      expect(radii.length).toBeGreaterThan(0);
      for (const radius of radii) expect(radius).toBeLessThanOrEqual(5);
    }
  }, 30_000);

  it('a box appears with a fade, then breathes; nothing is painted before the fade starts', async (context) => {
    if (!browser) return context.skip();
    const { tab, context: ctx } = await open(page('light'));
    const early = await beforeStyle(tab, '#s');
    await tab.waitForTimeout(600);
    const later = await beforeStyle(tab, '#s');
    await ctx.close();
    expect(early.content).toBe('""');
    expect(early.animation).toMatch(/coden-glow-breathe/);
    expect(early.animation).toMatch(/coden-glow-in/);
    expect(early.opacity).toBeLessThan(0.4);
    expect(later.opacity).toBeGreaterThan(0.35);
    expect(later.pointer).toBe('none');
    expect(later.position).toBe('absolute');
    expect(later.zIndex).toBe('-1');
    expect(later.filter).toBe('none');
    // It reaches a few pixels past the box, not a cloud around it, and paints nothing inside it.
    const edge = await (async () => { const { tab: t2, context: c2 } = await open(page('light')); const value = await t2.evaluate(() => { const style = getComputedStyle(document.querySelector('#s')!, '::before'); return { shadow: style.boxShadow, background: style.backgroundColor, inset: style.inset }; }); await c2.close(); return value; })();
    expect(edge.background).toBe('rgba(0, 0, 0, 0)');
    expect(edge.inset).toMatch(/^0px/);
    expect(edge.shadow).toMatch(/\b4px 0px\b/);
  }, 30_000);

  it('goes on the skeleton too, and stops with the switch', async (context) => {
    if (!browser) return context.skip();
    const on = await open(page('light'));
    expect((await beforeStyle(on.tab, '#s')).content).toBe('""');
    await on.context.close();
    const off = await open(page('light', 'data-shimmer-glow="off"'));
    expect((await off.tab.evaluate(() => getComputedStyle(document.querySelector('#t')!).filter))).toBe('none');
    expect((await beforeStyle(off.tab, '#s')).content).toBe('none');
    await off.context.close();
  }, 30_000);

  it('pauses when marked off screen, or when the tab is hidden', async (context) => {
    if (!browser) return context.skip();
    const { tab, context: ctx } = await open(page('dark'));
    await tab.evaluate(() => document.querySelector('#s')!.setAttribute('data-glow-paused', ''));
    expect((await beforeStyle(tab, '#s')).state).toContain('paused');
    await tab.evaluate(() => { document.querySelector('#s')!.removeAttribute('data-glow-paused'); document.documentElement.setAttribute('data-tab-hidden', ''); });
    expect((await beforeStyle(tab, '#s')).state).toContain('paused');
    await ctx.close();
  }, 30_000);

  it('is still and very soft with « reduce motion », and the text stays readable', async (context) => {
    if (!browser) return context.skip();
    const { tab, context: ctx } = await open(page('light'), { reducedMotion: 'reduce' });
    const style = await beforeStyle(tab, '#s');
    const text = await tab.evaluate(() => { const element = document.querySelector('#t')!; const s = getComputedStyle(element); return { color: s.color, clip: s.backgroundClip || (s as any).webkitBackgroundClip, animation: s.animationName }; });
    await ctx.close();
    expect(style.animation).toBe('none');
    expect(style.opacity).toBeCloseTo(0.3, 2);
    expect(text.animation).toBe('none');
    expect(text.color).not.toBe('rgba(0, 0, 0, 0)');
  }, 30_000);

  it('holds the frame rate with a dozen glows running, in both themes', async (context) => {
    if (!browser) return context.skip();
    const many = (theme: 'light' | 'dark') => page(theme).replace('</body>', `${Array.from({ length: 12 }, (_, index) => `<div class="row"><span class="coden-skeleton" style="width:${180 + index * 12}px"></span></div>`).join('')}</body>`);
    const results: Record<string, number> = {};
    for (const theme of ['light', 'dark'] as const) {
      const { tab, context: ctx } = await open(many(theme), { viewport: { width: 600, height: 700 } });
      await tab.waitForTimeout(500);
      results[theme] = await tab.evaluate(() => new Promise<number>(resolve => {
        const stamps: number[] = [];
        const tick = (time: number) => { stamps.push(time); if (time - stamps[0] < 2_000) requestAnimationFrame(tick); else resolve(Math.round(((stamps.length - 1) / ((stamps[stamps.length - 1] - stamps[0]) / 1000)) * 10) / 10); };
        requestAnimationFrame(tick);
      }));
      if (shots) { mkdirSync(shots, { recursive: true }); await tab.screenshot({ path: `${shots}/glow-${theme}.png`, clip: { x: 0, y: 0, width: 600, height: 200 } }); }
      await ctx.close();
    }
    if (shots) (await import('node:fs')).writeFileSync(`${shots}/fps.json`, JSON.stringify(results));
    // A software-rendered headless browser is a floor, not the target: a real GPU holds 60.
    for (const fps of Object.values(results)) expect(fps).toBeGreaterThan(30);
  }, 60_000);
});
