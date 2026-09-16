import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const component = read('./src/components/ui/ai-chat-input.tsx');
const mount = read('./src/mount-prompt-input.tsx');
const dashboard = read('./src/dashboard-react.tsx');
const landing = read('./src/landing-v3.ts');
const builder = read('./src/builder-live.ts');
const effort = read('./src/services/agent-effort.ts');
const motion = read('./src/styles/motion-tokens.css');
const horizon = read('./src/styles/coden-horizon-system.css');
const composerCss = read('./src/styles/coden-composer.css');
const pipeline = read('./src/services/multi-agent-pipeline.ts');
const server = read('./server.ts');

/*
 * One composer, on every surface that has one.
 *
 * Coden had three: a React form on the dashboard, hand-wired markup twice over
 * on the landing, and a textarea with its own resize handler in the Builder.
 * Three implementations of one control is how they drift into being three
 * different products, and two of the three had already lost the attach button.
 */
{
  assert.match(dashboard, /<PromptInput/, 'the dashboard mounts it');
  assert.match(landing, /mountPromptInput\(host, \{/, 'the landing mounts it');
  assert.match(builder, /renderComposer = \(\) => mountPromptInput\(row, \{/, 'the Builder mounts it');

  /*
   * Two of those three are not React. The island is how one component serves
   * them without a second implementation to keep in step.
   */
  assert.match(mount, /export function mountPromptInput/, 'there is one mounting helper');
  assert.match(mount, /host\.innerHTML = '';/,
    'and it clears the host, so the markup it replaces cannot answer queries underneath it');
  assert.match(mount, /const existing = roots\.get\(host\);\s*\n\s*if \(existing\) existing\.unmount\(\);/,
    'remounting the same host unmounts the previous root rather than stacking them');

  // The old per-surface composers are gone, not merely hidden behind the new one.
  assert.doesNotMatch(dashboard, /coden-dashboard-composer-submit/, 'the dashboard form is gone');
  assert.doesNotMatch(dashboard, /AgentModeComposer/, 'with its mode toggle');
  assert.doesNotMatch(builder, /function autoResizeChatInput/, 'the Builder resize handler is gone');
  assert.doesNotMatch(builder, /getElementById\('chat-textarea-box'\)/,
    'and nothing reaches for the textarea it used to own');
}

/*
 * A React-controlled field cannot be prefilled by writing `.value`.
 *
 * Both the landing and the Builder do prefill it — "start from a repository",
 * "adjust this plan", the restored draft prompt. Setting the DOM property on a
 * controlled textarea works until the component's next render and then
 * silently reverts, which is the worst kind of broken: it demos fine.
 */
{
  assert.match(landing, /type ComposerIsland = \{ setValue: \(value: string\) => void/,
    'the landing drives its composer through a handle');
  assert.match(landing, /hero\.setValue\(/, 'and the prefill links use it');
  assert.doesNotMatch(landing, /textarea\.value =/, 'rather than writing onto the DOM node');

  assert.match(builder, /function chatComposer\(\): ComposerHandle/,
    'the Builder has one adapter for the eleven places that used the textarea');
  assert.match(builder, /set value\(next: string\) \{ composerValue = next; renderComposer\(\); \}/,
    'whose setter re-renders instead of writing a property React will overwrite');
}

/*
 * Effort is not decoration.
 *
 * Three levels beside the prompt are a promise about how much work will be
 * done. `AgentLoopBudget` is what actually bounds a run, so that is what they
 * move — and the price moves with them, before the credit gate runs, because
 * a run granted twice the wall clock costs twice as much to serve.
 */
{
  assert.match(effort, /export const AGENT_EFFORT_LEVELS = \['Low', 'Medium', 'Max Effort'\]/,
    'the three levels are declared once');
  assert.match(effort, /Medium: \{ \.\.\.DEFAULT_AGENT_LOOP_BUDGET \}/,
    "Medium is today's default, unchanged, so the other two move away from a known point");
  assert.match(effort, /export function scaleRouteBudgetForEffort/, 'and the route budget scales with it');

  // Applied once, where the budget is read, not at each of its four consumers.
  assert.match(pipeline, /const routeBudget = scaleRouteBudgetForEffort\(budgetForRoute\(input\.route\), input\.effort\);/,
    'the pipeline scales its budget in one place');
  assert.match(pipeline, /effort\?: AgentEffort;/, 'and accepts the level');

  // Carried from the composer to the run, through every hop.
  assert.match(server, /const requestedEffort = normalizeAgentEffort\(req\.body\?\.effort\);/, 'the server reads it');
  assert.match(server, /effort: requestedEffort,/, 'hands it to the pipeline');
  assert.match(server, /effortCostMultiplier\(requestedEffort\)/, 'and prices it');
  assert.match(dashboard, /effort: meta\.effort,/, 'the dashboard sends it');
  assert.match(landing, /effort: meta\.effort/, 'and so does the landing');

  /*
   * Low costs less. A level that does less work for the same price is a level
   * nobody should pick, and shipping one is a quiet way of making the control
   * a lie in the other direction.
   */
  assert.match(effort, /if \(level === 'Low'\) return 0\.6;/, 'Low is cheaper');
  assert.match(effort, /if \(level === 'Max Effort'\) return 2\.5;/, 'Max Effort is dearer');
  assert.match(server, /Math\.max\(\s*\n\s*1,/, 'and no run is ever free');
}

/*
 * The selector offers models this product actually has.
 *
 * The reference listed GPT 5.5, Opus 4.8, Gemini 3.5 Flash, Composer 2.5 and
 * GLM 5.2. `normalizeModelSelectionId` accepts only ids in MODEL_REGISTRY and
 * returns 'auto' for everything else — so those five would have rendered, been
 * selectable, and changed nothing, which looks exactly like a working feature.
 */
{
  assert.match(component, /import \{ MODEL_REGISTRY, PROVIDER_META \}/, 'the options come from the registry');
  // Prose stripped: the comment above the list necessarily names the five it
  // exists to explain the absence of.
  const code = component.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const invented of ['GPT 5.5', 'Opus 4.8', 'Gemini 3.5 Flash', 'Composer 2.5', 'GLM 5.2']) {
    assert.ok(!code.includes(invented), `${invented} is not a model this product has`);
  }
  assert.match(component, /\{ id: AUTO_MODEL, label: "Auto", icon: "auto" \}/, 'Auto leads the list');

  /*
   * And the marks are local. The reference fetched five brand SVGs from
   * cdn.21st.dev on every render of the dropdown: an outbound request per icon
   * and someone else's uptime inside a paid product.
   */
  assert.doesNotMatch(code, /cdn\.21st\.dev/, 'no third-party icon host');
  assert.match(component, /providerIconSvg\(icon\)/, 'the marks are drawn from this repository');
}

/*
 * The microphone does not invent words.
 *
 * The reference typed a fixed English sentence into the field when the mic was
 * unavailable — demo scaffolding that, in production, puts a stranger's prompt
 * in a paying customer's composer moments after telling them dictation failed.
 */
{
  const body = component.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(body, /Framer Motion layout animation/, 'the simulated transcript is gone');
  assert.doesNotMatch(body, /simulateText/, 'and so is the function that typed it');
  assert.match(component, /if \(!stream\) \{\s*\n\s*stopRecording\(\);\s*\n\s*return;\s*\n\s*\}/,
    'no microphone simply means no dictation');

  // The stream and the audio graph are released, or the mic light stays on.
  assert.match(component, /streamRef\.current\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\);/, 'tracks stop');
  assert.match(component, /audioContextRef\.current\.close\(\);/, 'the audio context closes');
  assert.match(component, /return \(\) => \{\s*\n\s*stopRecording\(\);/, 'on unmount too');
}

/*
 * A run in flight outranks the microphone.
 *
 * The Builder's action button has to become a stop during generation. That is
 * a different state from the recording stop — the user still has a prompt, and
 * pressing it cancels the agent — so it gets its own prop rather than
 * borrowing one whose meaning is already taken.
 */
{
  assert.match(component, /const showStop = isRecording \|\| isBusy;/, 'busy shows the stop');
  assert.match(component, /\} else if \(isBusy\) \{\s*\n\s*onStop\?\.\(\);/, 'and pressing it stops the run');
  assert.match(builder, /onStop: \(\) => \{ void cancelBuild\(\); \}/, 'which the Builder wires to its own cancel');
  assert.match(builder, /isBusy: isGenerating,/, 'from its own generation state');
}

/*
 * What the component is written against, and what this repository had.
 *
 * Three shadcn semantics it uses were never declared here, and
 * tailwindcss-animate is not installed — so `bg-card` resolved to nothing, the
 * focus ring drew nothing, and every `animate-in` class was inert. None of
 * that fails loudly; it just quietly renders a duller component.
 */
{
  for (const token of ['--card:', '--card-foreground:', '--ring:']) {
    assert.ok(horizon.includes(token), `${token} is declared where every surface can see it`);
  }
  for (const utility of ['.animate-in', '.fade-in', '.zoom-in-95', '.zoom-in-90', '.slide-in-from-top-3', '.duration-400']) {
    assert.ok(motion.includes(utility), `${utility} exists, since the plugin that would provide it does not`);
  }
  assert.match(motion, /@keyframes coden-enter/, 'one keyframe reads the properties the utilities set');
  assert.match(motion, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.animate-in \{ animation: none; \}/,
    'and it can be switched off');

  /*
   * The scrollbar CSS the component shipped inline used
   * `hsl(var(--muted-foreground) / 0.3)`. That needs shadcn's bare HSL
   * triplets; Coden's tokens are whole colours, so it resolved to
   * `hsl(#64625e / 0.3)` — invalid, dropped, and the browser default painted
   * instead of the thumb it asked for.
   */
  assert.doesNotMatch(component, /__html: `[\s\S]{0,400}prompt-scrollbar/,
    'the inline style block is gone');
  assert.match(composerCss, /\.prompt-scrollbar::-webkit-scrollbar \{ width: 4px;/, 'and lives in a stylesheet');
  assert.match(composerCss, /color-mix\(in srgb, currentColor 30%, transparent\)/,
    'expressed in a form these tokens can actually produce');
}

console.log('prompt input composer tests passed');
