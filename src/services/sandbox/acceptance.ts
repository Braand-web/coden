/**
 * "It works", checked by using it.
 *
 * The live smoke test proved an application renders: not blank, no error
 * overlay, no console exception, no horizontal scroll. None of that says the
 * button that should add a task adds one. A to-do app whose "Add" button does
 * nothing passed every check the pipeline had.
 *
 * Two kinds of evidence close that gap:
 *
 * - Acceptance scenarios, written by the planner for this request — the three
 *   to five journeys a user would try first ("add a task, it appears, it is
 *   still there after a reload") — and executed here step by step in a real
 *   browser against the running preview.
 * - A generic exploration that needs no plan: every internal link must lead
 *   to a page that renders, and the visible buttons must do something.
 *
 * Both report in the vocabulary the repair loop already speaks, so a failed
 * journey reaches the coder the way a type error does: as a problem to fix,
 * naming what was tried and what did not happen.
 */

import type { Locator, Page } from 'playwright';

export type AcceptanceStep =
  | { action: 'click'; target: string }
  | { action: 'fill'; target: string; value: string }
  | { action: 'select'; target: string; value: string }
  | { action: 'press'; key: string }
  | { action: 'navigate'; path: string }
  | { action: 'reload' }
  | { action: 'expect_text'; text: string }
  | { action: 'expect_no_text'; text: string };

export type AcceptanceScenario = { name: string; steps: AcceptanceStep[] };

export type ScenarioResult = { name: string; ok: boolean; failedStep?: number; error?: string };

const MAX_SCENARIOS = 5;
const MAX_STEPS = 12;
const text = (value: unknown, max = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Whatever the planner returned, reduced to steps this runner can execute.
 *
 * A malformed step is dropped rather than failing the plan: the scenarios are
 * evidence, and a plan whose build is sound must not be rejected because one
 * of its checks was badly described.
 */
export function normalizeAcceptanceScenarios(value: unknown): AcceptanceScenario[] {
  if (!Array.isArray(value)) return [];
  const scenarios: AcceptanceScenario[] = [];
  for (const raw of value.slice(0, MAX_SCENARIOS)) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    const name = text(record.name, 120);
    if (!name || !Array.isArray(record.steps)) continue;
    const steps: AcceptanceStep[] = [];
    for (const rawStep of record.steps.slice(0, MAX_STEPS)) {
      if (!rawStep || typeof rawStep !== 'object') continue;
      const step = rawStep as Record<string, unknown>;
      const action = String(step.action || '');
      if (action === 'click' && text(step.target)) steps.push({ action, target: text(step.target) });
      else if ((action === 'fill' || action === 'select') && text(step.target) && typeof step.value === 'string') steps.push({ action, target: text(step.target), value: step.value.slice(0, 400) });
      else if (action === 'press' && /^[A-Za-z]{1,12}$/.test(String(step.key || ''))) steps.push({ action, key: String(step.key) });
      else if (action === 'navigate' && /^\/[\w\-./?=&#%]*$/.test(String(step.path || ''))) steps.push({ action, path: String(step.path) });
      else if (action === 'reload') steps.push({ action });
      else if ((action === 'expect_text' || action === 'expect_no_text') && text(step.text)) steps.push({ action, text: text(step.text) });
    }
    if (steps.some(step => step.action === 'expect_text' || step.action === 'expect_no_text')) scenarios.push({ name, steps });
  }
  return scenarios;
}

/** The contract the planner is given, next to its own JSON contract. */
export const ACCEPTANCE_CONTRACT = [
  'acceptance: 2 to 5 scenarios a real user would try first, each executed automatically in a browser against the running app.',
  'Shape: {"name":string,"steps":[step,...]}; step is one of',
  '{"action":"click","target":visible button/link text or aria-label}, {"action":"fill","target":field label or placeholder,"value":string},',
  '{"action":"select","target":field label,"value":option label}, {"action":"press","key":"Enter"}, {"action":"navigate","path":"/route"},',
  '{"action":"reload"}, {"action":"expect_text","text":visible text}, {"action":"expect_no_text","text":text that must be gone}.',
  'Each scenario starts on "/" with empty storage and must contain at least one expect_text. Use the exact labels the interface will show, in the user language.',
  'Cover the core journey (create/complete/remove the main object, or submit the main form) and persistence when data is created (reload, then expect it again).',
  'Never test external services, payments, email delivery or authentication with real credentials.',
].join('\n');

type LocateKind = 'click' | 'fill' | 'select';

/** Whether an element can take typed text or a chosen option. */
async function isFillable(element: Locator): Promise<boolean> {
  return element.evaluate(node => {
    const el = node as HTMLElement;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
    if (el.tagName !== 'INPUT') return false;
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'hidden', 'range', 'color'].includes(type);
  }).catch(() => false);
}

/*
 * Where a step lands depends on what the step does.
 *
 * One lookup served every action, buttons first — so "fill Nouvelle tâche"
 * found the button "Ajouter une nouvelle tâche" before the field with that
 * placeholder, and every journey failed on "Element is not an <input>". The
 * app was fine; the coder was then sent round after round to repair it, and
 * the run ran out of time doing so. A field is looked up among fields, a
 * control among controls.
 */
async function locate(page: Page, target: string, kind: LocateKind = 'click') {
  /*
   * Exact names first. "click Ajouter" on a page that also has "Ajouter une
   * nouvelle tâche" earlier in the DOM clicked the longer one; a partial
   * match is only the fallback when nothing is named exactly that.
   */
  for (const exactMatch of [true, false]) {
    const byName = { name: target, exact: exactMatch } as const;
    const byText = { exact: exactMatch } as const;
    const candidates = kind === 'click'
      ? [
        page.getByRole('button', byName),
        page.getByRole('link', byName),
        page.getByRole('tab', byName),
        page.getByRole('menuitem', byName),
        page.getByRole('checkbox', byName),
        page.getByLabel(target, byText),
        page.getByPlaceholder(target, byText),
        page.getByText(target, byText),
      ]
      : kind === 'select'
        ? [
          page.getByLabel(target, byText),
          page.getByRole('combobox', byName),
          page.getByRole('listbox', byName),
          // A visible label that is not wired to its control (no `for`).
          page.getByText(target, byText).locator('xpath=following::select[1]'),
        ]
        : [
          page.getByLabel(target, byText),
          page.getByPlaceholder(target, byText),
          page.getByRole('textbox', byName),
          page.getByRole('searchbox', byName),
          page.getByRole('spinbutton', byName),
          page.getByRole('combobox', byName),
          // A visible label that is not wired to its field (no `for`).
          page.getByText(target, byText).locator('xpath=following::*[self::input or self::textarea][1]'),
        ];
    for (const candidate of candidates) {
      const count = await candidate.count().catch(() => 0);
      for (let index = 0; index < Math.min(count, 6); index += 1) {
        const element = candidate.nth(index);
        if (!(await element.isVisible().catch(() => false))) continue;
        if (kind !== 'click' && !(await isFillable(element))) continue;
        return element;
      }
    }
  }
  return null;
}

async function visibleText(page: Page, value: string): Promise<boolean> {
  const needle = value.toLowerCase();
  return page.evaluate((search) => (document.body.innerText || '').toLowerCase().includes(search), needle).catch(() => false);
}

async function waitForText(page: Page, value: string, present: boolean, timeoutMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await visibleText(page, value)) === present) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

function describe(step: AcceptanceStep): string {
  switch (step.action) {
    case 'click': return `click "${step.target}"`;
    case 'fill': return `fill "${step.target}"`;
    case 'select': return `select "${step.value}" in "${step.target}"`;
    case 'press': return `press ${step.key}`;
    case 'navigate': return `open ${step.path}`;
    case 'reload': return 'reload the page';
    case 'expect_text': return `expect to see "${step.text}"`;
    case 'expect_no_text': return `expect "${step.text}" to be gone`;
  }
}

/** Runs each scenario from a clean start: the home page, empty storage. */
export async function runAcceptanceScenarios(page: Page, baseUrl: URL, scenarios: AcceptanceScenario[]): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    let failedStep: number | undefined;
    let error: string | undefined;
    try {
      await page.goto(baseUrl.href, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* storage unavailable */ } });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.waitForTimeout(250);
      for (let index = 0; index < scenario.steps.length; index += 1) {
        const step = scenario.steps[index];
        const fail = (reason: string) => { failedStep = index + 1; error = `${describe(step)}: ${reason}`; };
        if (step.action === 'click') {
          const element = await locate(page, step.target);
          if (!element) { fail('no visible element with this text or label'); break; }
          await element.click({ timeout: 3_000 });
          await page.waitForTimeout(250);
        } else if (step.action === 'fill') {
          const element = await locate(page, step.target, 'fill');
          if (!element) { fail('no visible field with this label or placeholder'); break; }
          await element.fill(step.value, { timeout: 3_000 });
        } else if (step.action === 'select') {
          const element = await locate(page, step.target, 'select');
          if (!element) { fail('no visible select with this label'); break; }
          await element.selectOption({ label: step.value }, { timeout: 3_000 }).catch(() => element.selectOption(step.value, { timeout: 3_000 }));
        } else if (step.action === 'press') {
          await page.keyboard.press(step.key);
          await page.waitForTimeout(200);
        } else if (step.action === 'navigate') {
          await page.goto(new URL(step.path, baseUrl).href, { waitUntil: 'domcontentloaded', timeout: 15_000 });
          await page.waitForTimeout(250);
        } else if (step.action === 'reload') {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
          await page.waitForTimeout(300);
        } else if (step.action === 'expect_text') {
          if (!(await waitForText(page, step.text, true))) { fail('the text never appeared'); break; }
        } else if (step.action === 'expect_no_text') {
          if (!(await waitForText(page, step.text, false))) { fail('the text is still visible'); break; }
        }
      }
    } catch (caught) {
      failedStep = failedStep ?? 0;
      error = error || (caught instanceof Error ? caught.message.split('\n')[0] : 'the step could not run').slice(0, 240);
    }
    results.push({ name: scenario.name, ok: !error, ...(error ? { failedStep, error } : {}) });
  }
  return results;
}

export type ExplorationResult = {
  routes: Array<{ path: string; ok: boolean; reason?: string }>;
  buttons: { attempted: number; changed: number; dead: string[] };
  deadAnchors: string[];
};

/**
 * Plan-free exploration: links lead somewhere, buttons do something.
 *
 * A button "does something" if clicking it changes the DOM, the URL or opens
 * a window. One that changes nothing is either decoration pretending to be a
 * control or a feature that was never wired — both of which a user finds on
 * the first click.
 */
export async function exploreApplication(page: Page, baseUrl: URL, options: { maxRoutes?: number; maxButtons?: number } = {}): Promise<ExplorationResult> {
  const result: ExplorationResult = { routes: [], buttons: { attempted: 0, changed: 0, dead: [] }, deadAnchors: [] };
  await page.goto(baseUrl.href, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.waitForTimeout(300);

  const links = await page.evaluate((origin) => {
    const paths = new Set<string>();
    const anchors = new Set<string>();
    for (const element of Array.from(document.querySelectorAll('a[href]'))) {
      const raw = element.getAttribute('href') || '';
      if (raw.startsWith('#')) { if (raw.length > 1) anchors.add(raw.slice(1)); continue; }
      try {
        const url = new URL(raw, location.href);
        if (url.origin === origin && !/\.(png|jpe?g|svg|pdf|zip)$/i.test(url.pathname)) paths.add(url.pathname);
      } catch { /* not a URL */ }
    }
    return { paths: [...paths], anchors: [...anchors] };
  }, baseUrl.origin).catch(() => ({ paths: [] as string[], anchors: [] as string[] }));

  for (const anchor of links.anchors.slice(0, 20)) {
    const exists = await page.evaluate((id) => Boolean(document.getElementById(id) || document.querySelector(`[name="${CSS.escape(id)}"]`)), anchor).catch(() => true);
    if (!exists) result.deadAnchors.push(`#${anchor}`);
  }

  for (const path of links.paths.filter(path => path !== baseUrl.pathname).slice(0, options.maxRoutes ?? 6)) {
    try {
      const response = await page.goto(new URL(path, baseUrl).href, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.waitForTimeout(300);
      const content = await page.evaluate(() => {
        const root = document.querySelector('#root,#app') || document.body;
        return { length: (root.textContent || '').trim().length, notFound: /\b(404|page not found|page introuvable)\b/i.test(root.textContent || '') };
      });
      const ok = Boolean(response?.ok()) && content.length > 0 && !content.notFound;
      result.routes.push({ path, ok, ...(ok ? {} : { reason: content.notFound ? 'shows a not-found page' : content.length ? `HTTP ${response?.status() ?? 0}` : 'renders nothing' }) });
    } catch (error) {
      result.routes.push({ path, ok: false, reason: error instanceof Error ? error.message.split('\n')[0].slice(0, 160) : 'did not load' });
    }
  }

  const maxButtons = options.maxButtons ?? 8;
  for (let index = 0; index < maxButtons; index += 1) {
    await page.goto(baseUrl.href, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(200);
    const buttons = page.locator('button:visible, [role="button"]:visible');
    const count = await buttons.count().catch(() => 0);
    if (index >= count) break;
    const button = buttons.nth(index);
    const label = text(await button.getAttribute('aria-label').catch(() => '') || await button.innerText().catch(() => ''), 60) || `button ${index + 1}`;
    if (await button.isDisabled().catch(() => false)) continue;
    // Already the current choice: clicking the selected tab is supposed to do nothing.
    const current = await button.evaluate(element => ['aria-selected', 'aria-pressed', 'aria-current', 'aria-checked']
      .some(name => element.getAttribute(name) === 'true' || (name === 'aria-current' && Boolean(element.getAttribute(name)) && element.getAttribute(name) !== 'false'))).catch(() => false);
    if (current) continue;
    const before = page.url();
    await page.evaluate(() => {
      const w = window as unknown as { __codenMutations: number; __codenObserver?: MutationObserver };
      w.__codenMutations = 0;
      w.__codenObserver?.disconnect();
      // Inline style is where animation libraries write every frame; it is
      // motion, not a response to the click, so it is not counted.
      w.__codenObserver = new MutationObserver(records => {
        w.__codenMutations += records.filter(record => !(record.type === 'attributes' && record.attributeName === 'style')).length;
      });
      w.__codenObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    }).catch(() => {});
    // Entrance animations mutate the DOM on their own. What the page does
    // while nobody touches it is the baseline a click has to exceed.
    await page.waitForTimeout(300);
    const quiet = await page.evaluate(() => {
      const w = window as unknown as { __codenMutations: number };
      const seen = w.__codenMutations || 0;
      w.__codenMutations = 0;
      return seen;
    }).catch(() => 0);
    const popup = page.context().waitForEvent('page', { timeout: 600 }).then(opened => { void opened.close().catch(() => {}); return true; }).catch(() => false);
    result.buttons.attempted += 1;
    try {
      await button.click({ timeout: 2_000 });
    } catch {
      continue;
    }
    await page.waitForTimeout(350);
    const mutated = await page.evaluate(() => (window as unknown as { __codenMutations?: number }).__codenMutations || 0).catch(() => 1);
    const changed = mutated > (quiet > 0 ? quiet + 2 : 0) || page.url() !== before || await popup;
    if (changed) result.buttons.changed += 1;
    else result.buttons.dead.push(label);
  }
  return result;
}
