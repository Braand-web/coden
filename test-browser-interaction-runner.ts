import assert from 'node:assert/strict';
import { runBrowserInteractionAudit } from './src/services/browser-interaction-runner.ts';

const disabled = await runBrowserInteractionAudit({
  files: [
    {
      path: 'index.html',
      content: '<!doctype html><html><body><button>Save</button></body></html>',
    },
  ],
  previewHtml: '<!doctype html><html><body><button>Save</button></body></html>',
  env: {},
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
