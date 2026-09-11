import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProviderGateway } from './src/services/provider-gateway.ts';

/*
 * A model is closed because it is failing now, not because it once failed.
 *
 * Two messages dominated production — "Ce modèle est temporairement
 * indisponible" and, after `4945f7b` reworded the same branch, "Ce modèle ne
 * répond pas pour le moment". Both come from one family in
 * `publicRuntimeErrorMessage`: /TIMEOUT|UNAVAILABLE|CIRCUIT/. What made them
 * constant rather than occasional was three separate defects compounding.
 *
 *  1. The loop started model calls it knew could not finish, and the resulting
 *     timeout was blamed on the provider.
 *  2. The breaker counted those failures with no notion of when they happened.
 *  3. Once open it could never close, because only a success cleared the count
 *     and no request is sent while it is open.
 *
 * The gateway is a single process-wide instance (`server.ts`), and the circuit
 * map is keyed by model alone — so all of this was shared by every user.
 */

/** A provider double that fails on demand, so the breaker can be driven. */
function failingGateway(options?: { failureThreshold?: number; breakerMs?: number }) {
  let calls = 0;
  let failNext = true;
  const openRouter: any = {
    async chat() {
      calls += 1;
      if (failNext) {
        const error: any = new Error('timeout');
        error.statusCode = 504;
        throw error;
      }
      return { text: 'ok', model: 'openai/gpt-5.6-luna', cost_usd: 0 };
    },
  };
  const gateway = new ProviderGateway(openRouter, options);
  return {
    gateway,
    calls: () => calls,
    succeed: () => { failNext = false; },
    fail: () => { failNext = true; },
  };
}

const MODEL = 'openai/gpt-5.6-luna';

async function attempt(gateway: ProviderGateway) {
  try {
    await gateway.chat(MODEL, [{ role: 'user', content: 'hi' }], { maxAttempts: 1 });
    return null;
  } catch (error: any) {
    return String(error?.diagnosticCode || '');
  }
}

// Three failures in a row still open the breaker. That part was right.
{
  const fake = failingGateway({ breakerMs: 50 });
  for (let i = 0; i < 3; i += 1) assert.equal(await attempt(fake.gateway), 'PROVIDER_TIMEOUT');
  assert.equal(await attempt(fake.gateway), 'PROVIDER_CIRCUIT_OPEN', 'a model failing right now is paused');
  const blockedAt = fake.calls();
  await attempt(fake.gateway);
  assert.equal(fake.calls(), blockedAt, 'and while it is paused no request is sent');
}

/*
 * Once the pause expires the model gets a real chance again, not one strike.
 *
 * This is the latch. The count survived the block, so the first failure after
 * it (4 >= 3) re-armed another full pause — and the one after that, and so on.
 * A model that had one bad minute stayed shut for the rest of the process.
 */
{
  const fake = failingGateway({ breakerMs: 30 });
  for (let i = 0; i < 3; i += 1) await attempt(fake.gateway);
  assert.equal(await attempt(fake.gateway), 'PROVIDER_CIRCUIT_OPEN');

  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(await attempt(fake.gateway), 'PROVIDER_TIMEOUT', 'the call is attempted again, not refused');

  const afterExpiry = fake.calls();
  assert.equal(await attempt(fake.gateway), 'PROVIDER_TIMEOUT', 'and a single failure does not re-arm the pause');
  assert.ok(fake.calls() > afterExpiry, 'the second attempt genuinely reached the provider');
}

// A success clears everything, as before.
{
  const fake = failingGateway({ breakerMs: 10_000 });
  await attempt(fake.gateway);
  await attempt(fake.gateway);
  fake.succeed();
  assert.equal(await attempt(fake.gateway), null);
  fake.fail();
  assert.equal(await attempt(fake.gateway), 'PROVIDER_TIMEOUT', 'the count restarted from the success, not from before it');
}

/*
 * Failures spread over time do not accumulate into a pause.
 *
 * `CIRCUIT_WINDOW_MS` is what gives the count an age. Without it, three
 * failures an hour apart on an otherwise healthy model closed it exactly like
 * three in a burst — the breaker was measuring how long the server had been
 * up.
 */
{
  const source = readFileSync(new URL('./src/services/provider-gateway.ts', import.meta.url), 'utf8');
  assert.match(source, /const CIRCUIT_WINDOW_MS = /, 'the failure count must have a window');
  assert.match(source, /windowStartedAt/, 'and each circuit must record when its window opened');
  const noteFailure = source.slice(source.indexOf('private noteFailure('), source.indexOf('private noteFailure(') + 900);
  assert.match(noteFailure, /now - previous\.windowStartedAt < CIRCUIT_WINDOW_MS/, 'failures outside the window start a new count');

  const getCircuit = source.slice(source.indexOf('private getCircuitError('), source.indexOf('private noteSuccess('));
  assert.match(getCircuit, /this\.circuits\.delete\(modelId\)/, 'an expired pause must clear the count that caused it');
}

/*
 * The loop stops on its own budget instead of manufacturing a provider failure.
 *
 * The guard was `>= deadline`, so a step with a fraction of a second left ran
 * anyway — and the timeout passed to the provider is the remainder, so it
 * expired by construction. Every run that reached its own budget donated a
 * `PROVIDER_TIMEOUT` to the model's breaker.
 */
{
  const loop = readFileSync(new URL('./src/services/llm-tool-loop.ts', import.meta.url), 'utf8');
  assert.match(loop, /const MIN_VIABLE_CALL_MS = /, 'a minimum viable call length must exist');

  // Only the guard that precedes a model call: the checks after a completion
  // and between tool executions are `>= deadline` and correctly so — neither
  // reaches the provider, so neither can be mistaken for a provider failure.
  const stepHead = loop.slice(loop.indexOf('for (let step = 0; step < maxSteps'), loop.indexOf('steps = step + 1;'));
  assert.match(stepHead, /deadline - Date\.now\(\) < MIN_VIABLE_CALL_MS/,
    'a step that cannot finish must end the run as out of time, not call the provider');
  assert.doesNotMatch(stepHead, /if \(Date\.now\(\) >= deadline\)/,
    'the old guard let doomed calls reach the provider');
}

/*
 * No caller hardcodes a deadline over the model's own profile any more.
 *
 * Twelve seconds for a conversation was below the first-token latency of a
 * deliberate model under load, so conversations on one failed by construction
 * — one attempt, no fallback when the model is pinned, and a circuit failure
 * charged to every other user of the process.
 */
{
  const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /timeoutMs: decision\.intent === 'conversation' \? 12_000/,
    'the conversation timeout must come from the model profile, not a constant');
  const options = server.slice(server.indexOf('const runtimeOptions = createProviderRuntimeOptions({'), server.indexOf('const runtimeOptions = createProviderRuntimeOptions({') + 1800);
  assert.doesNotMatch(options, /^\s*timeoutMs:/m, 'and no timeout is named at that call site at all');
}

console.log('provider failure attribution tests passed');
