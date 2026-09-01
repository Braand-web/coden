import assert from 'node:assert/strict';
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
