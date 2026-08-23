import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/services/create-project-flow.ts', 'utf8');
const mainSource = readFileSync('src/main.ts', 'utf8');
const authSource = readFileSync('src/auth.ts', 'utf8');
const builderSource = readFileSync('src/builder-live.ts', 'utf8');
const browserAuthSource = readFileSync('src/lib/supabase-browser.ts', 'utf8');

for (const status of ['preparing', 'opening_auth', 'creating_project', 'opening_builder', 'failed']) {
  assert.match(source, new RegExp(`['"]${status}['"]`), `flow must expose ${status}`);
}

assert.match(source, /coden-create-project-flow/);
assert.match(source, /coden-initial-prompt/);
assert.match(source, /coden-requested-mode/);
assert.match(source, /redirectToBuilder\(response\.project\.id, flow\)/);
assert.match(source, /!response\?\.success \|\| !response\.project\?\.id/);
assert.match(source, /options\.onStatus\?\.\('failed'\)/);
assert.match(source, /window\.location\.href = `\/auth\.html\?redirect=/);
assert.match(source, /projectNameFromPrompt\(prompt\)/);

assert.match(mainSource, /startCreateProjectFlow\(/);
assert.match(mainSource, /formatCreateProjectFlowStatus\(status, getLandingLang\(\)\)/);
assert.match(authSource, /safeRedirectTarget\(getRedirectTarget\(\)\)/);
assert.match(browserAuthSource, /function safeRedirectTarget/);
assert.match(browserAuthSource, /startsWith\(\s*['"]\/\/['"]\s*\)/);
assert.match(builderSource, /getInitialBuilderHandoff/);
assert.match(builderSource, /shouldAutoRun/);
assert.match(builderSource, /initialGenerationStarted/);

assert.doesNotMatch(source, /Preview ready|Application ready|Generated successfully/i);
assert.doesNotMatch(mainSource, /Preview ready|Application ready|Generated successfully/i);

console.log('create project flow contract tests passed');
