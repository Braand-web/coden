import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

const component = read('src/components/ui/ai-chat-input.tsx');
const mount = read('src/mount-prompt-input.tsx');
const dashboard = read('src/dashboard-react.tsx');
const builder = read('src/builder-live.ts');
const composerCss = read('src/styles/coden-composer.css');
const horizon = read('src/styles/coden-horizon-system.css');

assert.match(dashboard, /<PromptInput/, 'the dashboard mounts the shared composer');
assert.match(builder, /renderComposer = \(\) => mountPromptInput\(row, \{/, 'the Builder mounts the shared composer');
assert.match(mount, /export function mountPromptInput/, 'vanilla surfaces use one mounting helper');
assert.match(mount, /host\.innerHTML = '';/, 'remounting clears the host');
assert.match(mount, /const existing = roots\.get\(host\);\s*\n\s*if \(existing\) existing\.unmount\(\);/, 'remounting unmounts the previous root');

assert.doesNotMatch(dashboard, /coden-dashboard-composer-submit/, 'the dashboard has no legacy submit control');
assert.doesNotMatch(dashboard, /AgentModeComposer/, 'the dashboard has no legacy mode composer');
assert.doesNotMatch(builder, /function autoResizeChatInput/, 'the Builder has no legacy resize handler');
assert.doesNotMatch(builder, /getElementById\('chat-textarea-box'\)/, 'the Builder has no legacy textarea lookup');

assert.match(component, /cn\("coden-prompt-input relative flex flex-col w-full", className\)/,
  'the component has a scoped root');
assert.match(mount, /host\.classList\.add\('coden-composer-host'\);/, 'vanilla hosts have a shared marker');
assert.match(composerCss, /@layer base \{/, 'the scoped reset is layered');
assert.match(composerCss, /\.coden-prompt-input \*,\s*\n\s*\.coden-prompt-input \*::before/, 'the reset covers the component subtree');
assert.match(composerCss, /border: 0 solid;/, 'the reset does not erase requested borders');
assert.match(composerCss, /font: inherit;/, 'controls inherit the surface font');
assert.match(composerCss, /\.prompt-scrollbar::-webkit-scrollbar \{ width: 4px;/, 'the composer rail is compact');
assert.match(composerCss, /color-mix\(in srgb, currentColor 30%, transparent\)/, 'rail contrast uses the semantic current color');

assert.doesNotMatch(horizon, /data-coden-surface="landing-v3"/, 'the retired landing has no shared surface rules');
assert.doesNotMatch(composerCss, /data-coden-surface="landing-v3"/, 'the retired landing has no composer rules');

console.log('prompt input composer tests passed');
