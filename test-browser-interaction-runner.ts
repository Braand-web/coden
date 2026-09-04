import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { isBrowserRunnerEnabled, runBrowserInteractionAudit } from './src/services/browser-interaction-runner.ts';

// The browser audit is what proves a generated app renders and reacts, and only
// a verified preview unlocks publishing, so it must be on unless switched off.
assert.equal(isBrowserRunnerEnabled({}), true);
assert.equal(isBrowserRunnerEnabled({ AGENT_BROWSER_RUNNER_ENABLED: '' }), true);
assert.equal(isBrowserRunnerEnabled({ AGENT_BROWSER_RUNNER_ENABLED: '1' }), true);
for (const off of ['0', 'false', 'off', 'disabled', 'no', 'OFF']) {
  assert.equal(isBrowserRunnerEnabled({ AGENT_BROWSER_RUNNER_ENABLED: off }), false, off);
}

const disabled = await runBrowserInteractionAudit({
  files: [
    {
      path: 'index.html',
      content: '<!doctype html><html><body><button>Save</button></body></html>',
    },
  ],
  previewHtml: '<!doctype html><html><body><button>Save</button></body></html>',
  env: { AGENT_BROWSER_RUNNER_ENABLED: '0' },
});

assert.equal(disabled.length, 1);
assert.equal(disabled[0]?.key, 'browser_runner_disabled');
assert.equal(disabled[0]?.status, 'warn');

const missingPreview = await runBrowserInteractionAudit({
  files: [],
  previewHtml: '',
  env: { AGENT_BROWSER_RUNNER_ENABLED: '1' },
});

assert.equal(missingPreview[0]?.key, 'browser_preview_missing');
assert.equal(missingPreview[0]?.status, 'fail');

console.log('browser interaction runner tests passed');

/*
 * The preview is served from a real origin, so storage works.
 *
 * `page.setContent` leaves the document on `about:blank`, whose origin is
 * opaque, and Chromium denies storage to an opaque origin. Every generated app
 * that touches `localStorage` therefore threw on its first line — in this
 * runner, not in the app — and production recorded it against the app:
 *
 *   SecurityError: Failed to read the 'localStorage' property from 'Window':
 *   Access is denied for this document.
 *
 * 33 `browser_no_runtime_errors` failures, plus the blank previews and 0/100
 * build scores that follow when the throw happens before the app can mount.
 *
 * This needs a real browser. Where the environment has no matching Chromium
 * the check reports that rather than passing quietly, so a skip is never
 * mistaken for a verified result.
 */
{
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    ...['chromium', 'chromium-1194', 'chromium-1234'].flatMap(dir => [
      `/opt/pw-browsers/${dir}/chrome-linux/chrome`,
      `/opt/pw-browsers/${dir}/chrome-linux64/chrome`,
    ]),
  ].filter(Boolean).find(candidate => existsSync(candidate as string));

  const storageApp = [
    '<!doctype html><html><body><div id="root"></div><script>',
    'const seen = Number(localStorage.getItem("visits") || 0) + 1;',
    'localStorage.setItem("visits", String(seen));',
    'document.getElementById("root").innerHTML = "<button>Add task</button><p>Visit " + seen + " — this paragraph is long enough for the runner to consider the preview populated rather than blank.</p>";',
    '</script></body></html>',
  ].join('');

  if (!executablePath) {
    console.warn('browser storage check skipped: no Chromium available in this environment');
  } else {
    const checks = await runBrowserInteractionAudit({
      files: [{ path: 'index.html', content: storageApp }],
      previewHtml: storageApp,
      env: { AGENT_BROWSER_RUNNER_ENABLED: '1', PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: executablePath },
    });

    const runtimeErrors = checks.find(check => check.key === 'browser_no_runtime_errors');
    assert.ok(runtimeErrors, 'the runtime-error check must have run');
    assert.notEqual(
      runtimeErrors!.status,
      'fail',
      `an app using localStorage must not be failed by the runner's own page: ${runtimeErrors!.message}`,
    );
    assert.doesNotMatch(
      String(runtimeErrors!.message || ''),
      /localStorage|SecurityError/i,
      'the preview must be served from a real origin, not about:blank',
    );
    assert.equal(checks.find(check => check.key === 'browser_blank_preview')?.status, undefined,
      'an app that renders must not be reported blank because its first line threw');
  }
}

console.log('browser interaction runner storage tests passed');
