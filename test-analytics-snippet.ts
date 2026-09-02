import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildAnalyticsSnippet } from './src/services/analytics-snippet.ts';

/** The script body, as the browser would parse and run it. */
function scriptBody(snippet: string): string {
  const open = snippet.indexOf('>') + 1;
  return snippet.slice(open, snippet.lastIndexOf('</script>'));
}

/**
 * A page context. `storageThrows` reproduces an opaque origin or a browser with
 * site data blocked, where reading `window.localStorage` itself throws — which
 * is what the audit browser does, since it renders the preview at about:blank.
 */
function runIn(options: { origin: string; storageThrows?: boolean; apiBase?: string }) {
  const sent: string[] = [];
  const consoleErrors: string[] = [];
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
  };

  const window: any = {
    location: { origin: options.origin, pathname: '/' },
    addEventListener: () => {},
  };
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(window, name, {
      get() {
        if (options.storageThrows) {
          throw new Error(`Failed to read the '${name}' property from 'Window': Access is denied for this document.`);
        }
        return storage;
      },
    });
  }

  const sandbox: any = {
    window,
    document: { referrer: '', addEventListener: () => {} },
    navigator: { sendBeacon: (url: string) => { sent.push(url); return true; } },
    Blob: class { constructor(_parts: any[], _opts: any) {} },
    crypto: { randomUUID: () => 'uuid-0000' },
    fetch: (url: string) => { sent.push(url); return Promise.resolve(); },
    URL,
    setInterval: () => 1,
    clearInterval: () => {},
    console: { error: (...args: any[]) => consoleErrors.push(args.join(' ')) },
  };
  sandbox.globalThis = sandbox;
  sandbox.localStorage = undefined;
  Object.defineProperty(sandbox, 'localStorage', { get: () => window.localStorage });
  Object.defineProperty(sandbox, 'sessionStorage', { get: () => window.sessionStorage });

  const snippet = buildAnalyticsSnippet({ projectId: 'p1', environment: 'preview', apiBase: options.apiBase });
  let threw: Error | null = null;
  try {
    vm.runInNewContext(scriptBody(snippet), sandbox, { timeout: 2_000 });
  } catch (error: any) {
    threw = error;
  }
  return { threw, sent, consoleErrors, stored: store };
}

// The regression this module exists for. The beacon read `localStorage` at the
// call site, outside the try that was supposed to guard it, so it threw a
// SecurityError into the page it was measuring — recorded as a blocking
// browser_no_runtime_errors on every verified preview.
const hostile = runIn({ origin: 'null', storageThrows: true });
assert.equal(hostile.threw, null, `the beacon must never throw into the page: ${hostile.threw?.message}`);

// An opaque origin gives no endpoint, so nothing is requested — a request there
// fails with 400 and the browser logs it as an error in the measured page.
assert.deepEqual(hostile.sent, [], 'nothing may be sent from an opaque origin');

// Storage blocked but a real origin: still no throw, and the pageview is sent.
const blockedStorage = runIn({ origin: 'https://app.example', storageThrows: true });
assert.equal(blockedStorage.threw, null, 'blocked site data must not throw');
assert.deepEqual(blockedStorage.sent, ['https://app.example/api/analytics/collect']);

// The ordinary case still measures, and identity is persisted.
const normal = runIn({ origin: 'https://app.example' });
assert.equal(normal.threw, null);
assert.deepEqual(normal.sent, ['https://app.example/api/analytics/collect']);
assert.equal(normal.stored.get('coden_visitor_id'), 'uuid-0000');
assert.equal(normal.stored.get('coden_session_id'), 'uuid-0000');

// A configured API base wins over the page origin, opaque or not.
const configured = runIn({ origin: 'null', storageThrows: true, apiBase: 'https://api.coden.fun/' });
assert.equal(configured.threw, null);
assert.deepEqual(configured.sent, ['https://api.coden.fun/api/analytics/collect']);

// Structure: no storage read may sit outside the guard, and the body must be
// wrapped so a future line cannot escape either.
const snippet = buildAnalyticsSnippet({ projectId: 'p1', environment: 'production' });
const body = scriptBody(snippet);
assert.ok(/^\s*\(\(\) => \{\s*try \{/.test(body), 'the whole body must be wrapped in try/catch');
assert.ok(
  !/(?<!\.|')\b(localStorage|sessionStorage)\b(?!')/.test(body.replace(/window\[name\]/g, '')),
  'storage must only be reached by name inside the guard',
);
assert.doesNotThrow(() => new vm.Script(body), 'the embedded script must parse');

// Nothing to measure means nothing embedded.
assert.equal(buildAnalyticsSnippet({ projectId: '', environment: 'preview' }), '');

// The snippet must not be able to close its own script element.
assert.ok(!/<\/script/i.test(body), 'the body must not carry a closing script tag');

console.log('analytics snippet tests passed');
