import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyAgentStreamEvent, createAgentRunViewModel } from './src/services/agent-run-store.ts';

/**
 * The shimmer says what the pipeline is doing, and stops when it stops.
 *
 * The reference implementation cycled five fixed phrases on a three-second
 * timer. That is a progress indicator that cannot be wrong because it is not
 * measuring anything — it reads identically whether the backend is working,
 * hung, or already finished. What is drawn here is the run's current phase, and
 * it changes only when the server says the phase changed.
 */

const island = readFileSync('./src/builder-conversation-island.tsx', 'utf8');
const shimmer = readFileSync('./src/components/agent/agent-activity-shimmer.tsx', 'utf8');
const builder = readFileSync('./src/builder-live.ts', 'utf8');

// -- nothing rotates on a timer -------------------------------------------
for (const [name, source] of [['island', island], ['shimmer', shimmer]] as const) {
  assert.ok(!/setInterval/.test(source), `${name} must not drive the activity text on a timer`);
  assert.ok(!/phrases\s*\[/.test(source), `${name} must not cycle a fixed phrase list`);
}

// -- the text is keyed on the real phase, so a phase change re-animates ----
assert.match(shimmer, /key=\{`\$\{runId\}:\$\{phase\}:\$\{message\}`\}/, 'the animation must be keyed on the run and its phase');
assert.match(shimmer, /useReducedMotion/, 'motion must be opt-out');
assert.match(shimmer, /aria-live="polite"/, 'a screen reader must hear the phase change too');

/**
 * A run reports its phases, and each one reaches the shimmer.
 *
 * Driven through the real reducer with the real event shapes rather than
 * asserted on source: what matters is that the state the component reads
 * actually changes when the pipeline moves.
 */
let view = createAgentRunViewModel({ runId: 'run_1', prompt: 'build a calculator' });
const seen: string[] = [];
const phases = ['understanding', 'planning', 'building', 'testing', 'fixing'] as const;

phases.forEach((phase, index) => {
  view = applyAgentStreamEvent(view, {
    type: 'activity_changed',
    id: index + 1,
    sequence: index + 1,
    runId: 'run_1',
    phase,
    message: `phase ${phase}`,
    active: true,
  } as any);
  assert.equal(view.publicActivity?.phase, phase, `the shimmer must follow the run into ${phase}`);
  assert.equal(view.publicActivity?.active, true);
  seen.push(view.publicActivity!.message);
});
assert.equal(new Set(seen).size, phases.length, 'each phase must produce its own line, not a repeat');

// -- and it stops when the run produces its answer ------------------------
view = applyAgentStreamEvent(view, { type: 'assistant_message_completed', id: 99, sequence: 99, runId: 'run_1' } as any);
assert.equal(view.publicActivity?.active, false, 'a finished run must not keep claiming it is working');

/**
 * The label reaches the screen.
 *
 * `setWorking` wrote the phase into `liveRun.activeText`, which nothing renders
 * — the shimmer draws `view.publicActivity`. So the panel stayed blank between
 * the user pressing send and the first server event, which is the window where
 * a reader most needs to see that something started.
 */
const setWorking = island.slice(island.indexOf('setWorking(id, label) {'), island.indexOf('clearWorking(id) {'));
assert.match(setWorking, /run\.view\.publicActivity = \{/, 'setWorking must seed the state the shimmer reads');
assert.match(setWorking, /sequence: 0/, 'the local placeholder must sort below every server event');
assert.match(setWorking, /\(run\.view\.publicActivity\?\.sequence \?\? -1\) < 0/,
  'a placeholder must never overwrite a phase the server already reported');

const clearWorking = island.slice(island.indexOf('clearWorking(id) {'), island.indexOf('setBlock(id, block) {'));
assert.match(clearWorking, /active: false/, 'clearing the working state must stop the shimmer');

// -- the stubs left behind by the old removal are gone --------------------
assert.ok(!builder.includes('[REMPLACEMENT STREAMING UI ICI]'), 'the placeholder anchors must be gone');
assert.match(builder, /conversationApi\.appendAssistantDelta\(id, text\)/, 'assistant deltas must be rendered, not discarded');
const setShimmer = builder.slice(builder.indexOf('function setMessageShimmer'), builder.indexOf('function clearMessageShimmer'));
assert.ok(!/withTimer/.test(setShimmer), 'the dead timer parameter must be gone');
assert.ok(!builder.includes("setMessageShimmer(card, '', false)"), 'no call site may pass an empty label, which draws nothing');

console.log('pipeline shimmer tests passed');
