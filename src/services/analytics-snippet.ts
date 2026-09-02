/**
 * The analytics beacon embedded in generated previews and published apps.
 *
 * It runs inside someone else's page, in contexts we do not control: a
 * sandboxed iframe, an opaque origin, a browser with site data blocked. So the
 * one rule is that it may never surface an error to the page it is measuring.
 *
 * It broke that rule twice, and both showed up as blocking `browser_no_runtime_errors`:
 *
 *   const storageGet = (store, key) => { try { return store.getItem(key); } catch { return ''; } };
 *   let visitorId = storageGet(localStorage, 'coden_visitor_id');
 *
 * `localStorage` is evaluated at the call site, before the function runs, and
 * reading `window.localStorage` on an opaque origin throws a SecurityError —
 * outside the try that was meant to protect it. Storage is now resolved by name
 * inside the guard, and the whole body sits in a try/catch so no future line
 * can escape either.
 *
 * The beacon also fired from `about:blank`, where the origin is the string
 * "null" and the endpoint resolves to garbage: the request failed with 400 and
 * the browser logged it. With no configured API base and no usable origin there
 * is nothing to report to, so it now stays quiet instead.
 */

export type AnalyticsSnippetInput = {
  projectId: string;
  environment: 'preview' | 'production';
  apiBase?: string;
};

/** The `<script>` element to embed, or an empty string when there is nothing to measure. */
export function buildAnalyticsSnippet(input: AnalyticsSnippetInput): string {
  const projectId = String(input.projectId || '');
  if (!projectId) return '';
  const environment = input.environment === 'production' ? 'production' : 'preview';
  const apiBase = String(input.apiBase || '').replace(/\/$/, '');

  const body = `
(() => {
  try {
    const projectId = ${JSON.stringify(projectId)};
    const environment = ${JSON.stringify(environment)};
    const apiBase = ${JSON.stringify(apiBase)};
    const origin = (() => { try { return String(window.location.origin || ''); } catch (e) { return ''; } })();
    // An opaque origin ("null") gives no endpoint to report to, and requesting
    // one anyway fails with 400 and logs an error into the measured page.
    const base = apiBase || (origin && origin !== 'null' ? origin : '');
    if (!base) return;
    const endpoint = base.replace(/\\/$/, '') + '/api/analytics/collect';

    const safeId = () => {
      try {
        if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      } catch (e) {}
      return String(Date.now()) + Math.random().toString(16).slice(2);
    };
    // Resolved by name inside the guard: reading window.localStorage itself
    // throws on an opaque origin or when site data is blocked.
    const storageGet = (name, key) => { try { return window[name].getItem(key) || ''; } catch (e) { return ''; } };
    const storageSet = (name, key, value) => { try { window[name].setItem(key, value); } catch (e) {} };

    let visitorId = storageGet('localStorage', 'coden_visitor_id');
    if (!visitorId) { visitorId = safeId(); storageSet('localStorage', 'coden_visitor_id', visitorId); }
    let sessionId = storageGet('sessionStorage', 'coden_session_id');
    if (!sessionId) { sessionId = safeId(); storageSet('sessionStorage', 'coden_session_id', sessionId); }

    const startedAt = Date.now();
    const source = (() => {
      try {
        if (!document.referrer) return 'Direct';
        const referrer = new URL(document.referrer);
        if (/builder\\.html|dashboard\\.html|auth\\.html/i.test(referrer.pathname)) return 'Direct';
        return referrer.hostname || 'Direct';
      } catch (e) { return 'Direct'; }
    })();

    const send = (eventType) => {
      try {
        const payload = {
          project_id: projectId,
          event_type: eventType,
          page_path: window.location.pathname || '/',
          session_id: sessionId,
          visitor_id: visitorId,
          source,
          duration_seconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
          environment,
        };
        const requestBody = JSON.stringify(payload);
        if (navigator.sendBeacon) {
          if (navigator.sendBeacon(endpoint, new Blob([requestBody], { type: 'application/json' }))) return;
        }
        fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: requestBody, keepalive: true }).catch(() => {});
      } catch (e) {}
    };

    send('pageview');
    const heartbeat = setInterval(() => send('heartbeat'), 60000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') send('duration');
    });
    window.addEventListener('beforeunload', () => {
      clearInterval(heartbeat);
      send('duration');
    });
  } catch (e) {}
})();`;

  return `\n<script data-coden-analytics="true">${body}\n</script>`;
}
