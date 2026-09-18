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
assert.match(mount, /host\.innerHTML = '';/, 'a first mount clears the host');
/*
 * A second call re-renders into the root that is already there.
 *
 * This assertion used to require the opposite — unmount, then create a new
 * root — which is what made the composer lose its state. The Builder calls
 * `mountPromptInput` on every keystroke, so a remount threw away the chosen
 * model, the effort level and any attachments between two characters.
 */
assert.match(mount, /if \(existing\) \{\s*\n\s*existing\.render\(<PromptInput \{\.\.\.props\} \/>\);/,
  'a repeat mount re-renders the existing root instead of remounting');
assert.doesNotMatch(mount, /if \(existing\) existing\.unmount\(\);/,
  'a repeat mount never discards component state');

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

/*
 * The model and the effort belong to the session, not to the mounted control.
 *
 * All three were the same failure seen from three angles: the choice existed
 * only inside the component, so nothing outside it could read the choice back
 * or send it anywhere.
 */
assert.match(component, /model\?: string;/, 'the composer accepts a controlled model');
assert.match(component, /effort\?: string;/, 'the composer accepts a controlled effort');
assert.match(component, /onModelChange\?: \(model: string\) => void;/, 'the composer reports a model change');
assert.match(component, /onEffortChange\?: \(effort: string\) => void;/, 'the composer reports an effort change');
assert.doesNotMatch(component, /useState\(models\[0\]\)/, 'the composer no longer forces Auto on every mount');
assert.match(component, /const isModelControlled = controlledModel !== undefined;/,
  'the model follows the same controlled resolution as the value');
assert.match(component, /const isEffortControlled = controlledEffort !== undefined;/,
  'the effort follows the same controlled resolution as the value');

assert.match(builder, /model: selectedModel\(\),\s*\n\s*effort: composerEffort,/,
  'the Builder owns the model and the effort the composer displays');
assert.match(builder, /onModelChange: next => applySelectedModel\(next, \{ persist: true, saveWorkspace: true \}\)/,
  'a model chosen in the Builder is persisted when it is chosen');
assert.match(builder, /onEffortChange: next => applySelectedEffort\(next\)/,
  'an effort chosen in the Builder is persisted when it is chosen');

/*
 * `/generate` has read `req.body.effort` since the control shipped. Nothing
 * ever put it there, so every run was priced and budgeted as Medium whatever
 * the composer displayed.
 */
assert.match(builder, /modelId: selectedModel\(\),[\s\S]{0,700}?\n\s*effort: composerEffort,/,
  'the generation request carries the effort the composer is showing');

/*
 * A menu may only offer what the workspace can actually run.
 *
 * It listed the whole catalogue and never consulted the plan, so nine of the
 * fourteen entries were traps on a free workspace: the request reached the
 * router, threw `ModelNotAllowedForPlanError`, and came back as a bare
 * GENERATION_FAILED. Production logged exactly that twice in fourteen seconds
 * on `anthropic/claude-opus-5`.
 */
assert.match(component, /plan\?: string;/, 'the composer is told which plan it is rendering for');
assert.match(component, /function isModelLockedForPlan\(modelId: string, plan\?: string\): boolean/,
  'the composer knows which models the plan cannot run');
assert.match(component, /if \(isModelLockedForPlan\(next, plan\)\) return;/,
  'a locked model cannot be selected');
assert.match(component, /isModelLockedForPlan\(offeredModel, plan\) \? models\[0\] : offeredModel/,
  'a stored selection the plan cannot run resolves back to Auto instead of failing every turn');
assert.match(component, /disabled=\{locked\}/, 'a locked entry is disabled, not merely styled');
assert.match(component, /Requiert le plan \$\{PLAN_LABELS\[requiredPlan\]\}/,
  'a locked entry says which plan it needs rather than failing silently');

assert.match(builder, /plan: currentPlanKey,/, 'the Builder passes its workspace plan to the composer');
assert.match(builder, /applySelectedModel\('auto', \{ persist: true, saveWorkspace: true \}\)/,
  'a stored model the plan cannot run is dropped once the plan is known');
assert.match(dashboard, /plan=\{profile\?\.plan\?\.key\}/, 'the dashboard passes its plan too');

const preferences = read('src/lib/composer-preferences.ts');
assert.match(preferences, /export const SELECTED_MODEL_STORAGE_KEY = 'coden-selected-model';/,
  'one module owns the stored model key');
assert.match(preferences, /export const SELECTED_EFFORT_STORAGE_KEY = 'coden-selected-effort';/,
  'the effort is remembered too');
for (const [surface, source] of [['the landing', read('src/landing-new.ts')], ['the dashboard', dashboard], ['the Builder', builder]] as const) {
  assert.match(source, /composer-preferences/, `${surface} reads the shared composer preference`);
}

console.log('prompt input composer tests passed');
