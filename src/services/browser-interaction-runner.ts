import type { AgentGeneratedFile, AgentVerificationCheck } from './agent-v2.ts';
import { redactSecrets } from './secret-redaction.ts';

export type BrowserInteractionAuditInput = {
  files: AgentGeneratedFile[];
  previewHtml?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
};

export type BrowserFinding = {
  key: string;
  severity: 'info' | 'low' | 'medium' | 'high';
  message: string;
  selector?: string;
  viewport?: 'desktop' | 'mobile';
  public_payload?: Record<string, unknown>;
};

export type BrowserTestResult = {
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  duration_ms: number;
  findings: BrowserFinding[];
  checks: AgentVerificationCheck[];
};

type PlaywrightModule = {
  chromium: {
    launch(options?: Record<string, unknown>): Promise<any>;
  };
};

const CONTROL_SELECTOR = 'button, [role="button"], input, select, textarea, a[href]';

/**
 * The origin the audited preview is served from. It resolves to nothing — the
 * document is fulfilled by a route, never fetched — but it has to be a real
 * https origin so the page gets storage, cookies and a same-origin document.
 */
const PREVIEW_ORIGIN = 'https://preview.coden.local/';

type BrowserControlProbe = {
  index: number;
  tag: string;
  type: string;
  href: string;
  label: string;
  disabled: boolean;
};

export async function runBrowserInteractionAudit(input: BrowserInteractionAuditInput): Promise<AgentVerificationCheck[]> {
  return (await runBrowserInteractionAuditDetailed(input)).checks;
}

export async function runBrowserInteractionAuditDetailed(input: BrowserInteractionAuditInput): Promise<BrowserTestResult> {
  const startedAt = Date.now();
  const env = input.env || process.env;
  if (!isBrowserRunnerEnabled(env)) {
    return result('skipped', startedAt, [finding('browser_runner_disabled', 'low', 'Browser interaction runner is disabled; static visual and functional checks were used.')]);
  }

  const html = String(input.previewHtml || input.files.find(file => /(?:^|\/)index\.html$/i.test(file.path))?.content || '');
  if (!html.trim()) {
    return result('failed', startedAt, [finding('browser_preview_missing', 'high', 'Browser runner could not inspect an empty preview.')]);
  }

  const playwright = await loadPlaywright();
  if (!playwright) {
    return result('warning', startedAt, [finding('browser_runner_unavailable', 'low', 'Browser runner is enabled but Playwright is not installed in this environment.')]);
  }

  const timeoutMs = Math.max(3_000, Math.min(input.timeoutMs || 20_000, 30_000));
  const runtimeErrors: string[] = [];
  const clickErrors: string[] = [];
  const findings: BrowserFinding[] = [];
  let browser: any = null;

  try {
    // Nix-based images ship their own Chromium rather than the build Playwright
    // pins, so allow the deployment to point at it instead of failing to launch.
    const executablePath = String(env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '').trim();
    browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      ...(executablePath ? { executablePath } : {}),
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (error: Error) => runtimeErrors.push(redactError(error.message)));
    page.on('console', (message: any) => {
      if (message.type?.() === 'error') runtimeErrors.push(redactError(message.text?.() || 'Console error'));
    });

    /*
     * The preview must be served from a real origin, not pasted into a blank one.
     *
     * `page.setContent` leaves the document on `about:blank`, which has an
     * opaque origin, and Chromium denies storage to an opaque origin. So any
     * generated app that touches `localStorage` — a to-do list, a notes app,
     * a theme toggle, most small web apps — threw on its first line:
     *
     *   SecurityError: Failed to read the 'localStorage' property from
     *   'Window': Access is denied for this document.
     *
     * That is this runner's error, not the application's, and it was recorded
     * against the application: 33 `browser_no_runtime_errors` failures, and
     * with the throw happening before React could mount, 14 blank previews,
     * 16 blank mobile previews and 36 build scores of 0/100. The repair loop
     * then spent its rounds hunting a bug that was not in the code, and the
     * user was shown a working app as broken.
     *
     * Serving the same HTML over a routed navigation gives the document a
     * normal https origin, so storage behaves as it will for the real user.
     * Only the document request is fulfilled; anything the page loads for
     * itself still goes out as before.
     */
    await page.route('**/*', (route: any) => (
      route.request().resourceType() === 'document'
        ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html.replace(/<head(\s[^>]*)?>/i, match => `${match}<link rel="icon" href="data:,">`) })
        : route.continue()
    ));
    await page.goto(PREVIEW_ORIGIN, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 4_000) }).catch(() => null);

    const before = await page.evaluate(() => ({
      text: document.body?.innerText || '',
      htmlLength: document.body?.innerHTML?.length || 0,
      width: document.documentElement?.scrollWidth || 0,
      height: document.documentElement?.scrollHeight || 0,
      viewportWidth: window.innerWidth,
      bodyRectCount: document.body ? document.body.getClientRects().length : 0,
      formCount: document.querySelectorAll('form').length,
      feedbackMarkers: document.querySelectorAll('[role="status"], [aria-live], .feedback, .toast, .alert, .error, .success, [data-feedback]').length,
      hasDialog: Boolean(document.querySelector('[role="dialog"], dialog, [aria-modal="true"]')),
    }));

    if (!before.text.trim() || before.htmlLength < 80 || before.bodyRectCount === 0) {
      findings.push(finding('browser_blank_preview', 'high', 'Browser rendered an empty or nearly empty preview.', undefined, 'desktop'));
    }

    if (before.formCount > 0 && before.feedbackMarkers === 0 && !/\b(error|success|saved|invalid|required|feedback|chargement|enregistre|erreur|valide)\b/i.test(before.text)) {
      findings.push(finding('browser_form_feedback_missing', 'medium', 'Forms need visible success, error, loading, or validation feedback.', undefined, 'desktop', { form_count: before.formCount }));
    }

    const controls: BrowserControlProbe[] = await page.evaluate((selector: string): BrowserControlProbe[] => {
      return Array.from(document.querySelectorAll(selector)).map((element, index) => {
        element.setAttribute('data-coden-probe', String(index));
        const tag = element.tagName.toLowerCase();
        const input = element as HTMLInputElement;
        return {
          index,
          tag,
          type: input.type || '',
          href: element.getAttribute('href') || '',
          label: (element.textContent || element.getAttribute('aria-label') || input.placeholder || '').trim().slice(0, 80),
          disabled: Boolean((element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true'),
        };
      });
    }, CONTROL_SELECTOR);

    let changedControls = 0;
    for (const control of controls.slice(0, 8)) {
      if (control.disabled) continue;
      if (control.tag === 'a' && /^(https?:)?\/\//i.test(control.href)) continue;
      const selector = `[data-coden-probe="${control.index}"]`;
      try {
        const locator = page.locator(selector).first();
        if (['input', 'textarea'].includes(control.tag) && !/^(button|submit|checkbox|radio|range|file)$/i.test(control.type)) {
          await locator.fill('Test', { timeout: 1_500 });
        } else if (control.tag === 'select') {
          const values = await locator.evaluate((element: HTMLSelectElement) => Array.from(element.options).map(option => option.value).filter(Boolean));
          if (values[0]) await locator.selectOption(values[0], { timeout: 1_500 });
        } else {
          await locator.click({ timeout: 1_500 });
        }
        const afterControl = await page.evaluate(() => ({
          text: document.body?.innerText || '',
          htmlLength: document.body?.innerHTML?.length || 0,
        }));
        if (afterControl.text !== before.text || afterControl.htmlLength !== before.htmlLength) changedControls += 1;
      } catch (error: any) {
        clickErrors.push(redactError(error?.message || 'Control interaction failed'));
        findings.push(finding('browser_control_interaction_failed', 'high', `Control could not be interacted with: ${redactError(error?.message || 'Control interaction failed')}`, selector, 'desktop', { label: control.label || control.tag }));
      }
    }

    if (controls.length > 0 && changedControls === 0) {
      findings.push(finding('browser_actions_change_state', 'medium', 'Browser interactions did not visibly change the page; primary controls need feedback or state changes.', undefined, 'desktop'));
    }

    const destructiveControls = controls.filter(control => /\b(delete|remove|reset|clear|destroy|supprimer|effacer|vider|retirer)\b/i.test(control.label));
    if (destructiveControls.length && before.feedbackMarkers === 0 && !before.hasDialog && !/\b(confirm|confirmation|undo|annuler|cancel|restore|rollback|deleted|supprim|feedback)\b/i.test(before.text)) {
      findings.push(finding('browser_destructive_feedback_missing', 'medium', 'Destructive controls need confirmation, undo, cancel, or visible feedback.', undefined, 'desktop', {
        controls: destructiveControls.slice(0, 4).map(control => control.label || control.tag),
      }));
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(120).catch(() => null);
    const mobile = await page.evaluate(() => {
      const offenders = Array.from(document.body?.querySelectorAll('*') || [])
        .filter((element) => {
          const rect = (element as HTMLElement).getBoundingClientRect();
          return rect.width > window.innerWidth + 2 || rect.left < -8 || rect.right > window.innerWidth + 8;
        })
        .slice(0, 6)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          className: String((element as HTMLElement).className || '').slice(0, 80),
          text: String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        }));
      return {
        text: document.body?.innerText || '',
        scrollWidth: document.documentElement?.scrollWidth || 0,
        innerWidth: window.innerWidth,
        offenders,
      };
    });

    if (!mobile.text.trim()) {
      findings.push(finding('browser_mobile_blank_preview', 'high', 'Mobile viewport rendered a blank preview.', undefined, 'mobile'));
    }
    if (mobile.scrollWidth > mobile.innerWidth + 12 || mobile.offenders.length) {
      findings.push(finding('browser_mobile_overflow', 'medium', 'Mobile viewport has horizontal overflow or oversized elements.', undefined, 'mobile', { offenders: mobile.offenders }));
    }

    if (runtimeErrors.length) {
      findings.push(finding('browser_no_runtime_errors', 'high', `Preview raised runtime errors: ${runtimeErrors.slice(0, 3).join(' | ')}`));
    }
    if (clickErrors.length) {
      findings.push(finding('browser_primary_controls_clickable', 'high', `Some visible controls could not be interacted with: ${clickErrors.slice(0, 3).join(' | ')}`));
    }
    if (!findings.some(item => item.key === 'browser_no_runtime_errors')) {
      findings.push(finding('browser_no_runtime_errors', 'info', 'Preview loaded without browser runtime errors.'));
    }
    if (!findings.some(item => item.key === 'browser_primary_controls_clickable')) {
      findings.push(finding('browser_primary_controls_clickable', 'info', controls.length ? 'Primary controls accepted browser interactions.' : 'No browser controls were detected for this preview.'));
    }
    findings.push(finding('browser_runner_duration', 'info', `Browser interaction audit completed in ${Date.now() - startedAt}ms.`, undefined, undefined, { duration_ms: Date.now() - startedAt }));
    return result(statusForFindings(findings), startedAt, findings);
  } catch (error: any) {
    return result('warning', startedAt, [finding('browser_runner_failed', 'low', `Browser interaction runner could not complete: ${redactError(error?.message || 'Unknown browser runner error')}`)]);
  } finally {
    await browser?.close?.().catch(() => null);
  }
}

function finding(
  key: string,
  severity: BrowserFinding['severity'],
  message: string,
  selector?: string,
  viewport?: BrowserFinding['viewport'],
  public_payload?: Record<string, unknown>,
): BrowserFinding {
  return { key, severity, message, selector, viewport, public_payload };
}

function statusForFindings(findings: BrowserFinding[]): BrowserTestResult['status'] {
  if (findings.some(item => item.severity === 'high' && !/_duration$|_errors$/.test(item.key))) return 'failed';
  if (findings.some(item => item.severity === 'high')) return 'failed';
  if (findings.some(item => item.severity === 'medium' || item.severity === 'low')) return 'warning';
  return 'passed';
}

function result(status: BrowserTestResult['status'], startedAt: number, findings: BrowserFinding[]): BrowserTestResult {
  return {
    status,
    duration_ms: Date.now() - startedAt,
    findings,
    checks: findings.map(item => ({
      key: item.key,
      status: item.severity === 'high' ? 'fail' : item.severity === 'info' ? 'pass' : 'warn',
      severity: item.severity,
      message: item.message,
      file: item.selector,
    })),
  };
}

/**
 * The browser audit is the only check that proves a generated app actually
 * renders and reacts, and a verified preview is what unlocks publishing. It is
 * therefore on by default and must be switched off explicitly.
 */
export function isBrowserRunnerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.AGENT_BROWSER_RUNNER_ENABLED;
  if (raw === undefined || raw === '') return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(raw.trim().toLowerCase());
}

async function loadPlaywright(): Promise<PlaywrightModule | null> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<PlaywrightModule>;
    return await dynamicImport('playwright');
  } catch {
    return null;
  }
}

function redactError(value: string) {
  return redactSecrets(value, '[redacted]').slice(0, 600);
}
