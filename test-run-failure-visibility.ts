import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicRuntimeErrorMessage } from './src/services/ai-model-runtime.ts';

const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

/*
 * What production showed, and what must never come back.
 *
 * Three failures, all recorded against real user runs:
 *
 *  - a run ended with the string `TOOL_BUDGET_EXCEEDED` written into the
 *    conversation, because the route answered with `error.message` verbatim;
 *  - `turn.failed { diagnostic_code: null }` on 2026-09-04 at 14:53, because
 *    the conversation branch computed a diagnosis, stored it, and then left
 *    it out of the response — and returned HTTP 200 for a failed run;
 *  - five `agent_runs` and three `agent_turns` stranded in `running`, the
 *    oldest for five days, because nothing ever finished a run whose process
 *    had gone.
 */

// A public message is written for a person: it never restates the code.
for (const code of [
  'TOOL_BUDGET_EXCEEDED',
  'AGENT_EXECUTION_FAILED',
  'PROVIDER_TIMEOUT',
  'MODEL_OUTPUT_TRUNCATED',
  'PROVIDER_QUOTA_OR_BILLING',
  'MODEL_CATALOG_UNAVAILABLE',
]) {
  for (const locale of ['fr', 'en'] as const) {
    const message = publicRuntimeErrorMessage(code, locale);
    assert.ok(message.length > 20, `${code} (${locale}) must produce a sentence.`);
    assert.doesNotMatch(message, /[A-Z]{4,}_[A-Z]/, `${code} (${locale}) must not print a diagnostic code at the user.`);
  }
}
assert.notEqual(
  publicRuntimeErrorMessage('PROVIDER_TIMEOUT', 'fr'),
  publicRuntimeErrorMessage('PROVIDER_TIMEOUT', 'en'),
  'A French request must not be answered in English.',
);

// The pipeline boundary answers with that sentence, not with the exception.
assert.match(
  server,
  /error: publicRuntimeErrorMessage\(diagnosticCode, frenchActivity \? 'fr' : 'en'\)/,
  'the multi-agent failure boundary must speak to the user, not echo the exception',
);
assert.doesNotMatch(
  server,
  /error:redactSecrets\(error\?\.message \|\| 'Execution failed'/,
  'the raw exception message must not be the user-facing error again',
);

// The conversation branch carries its diagnosis all the way out.
{
  const branch = server.slice(server.indexOf('const diagnostic = diagnoseProviderError(error);\n      await updateAgentRunStatus(agentRunId'));
  const response = branch.slice(0, branch.indexOf('}'));
  assert.match(response, /diagnostic_code: diagnostic\.diagnostic_code/, 'a failed conversation must report why it failed');
  assert.match(response, /suggested_action: diagnostic\.suggested_action/, 'and what the user can do about it');
  assert.doesNotMatch(response, /respondJson\([^)]*\b200\b/, 'a failed run must not answer with a success status');
}

// A run whose process is gone is finished at boot, not left spinning.
assert.match(server, /async function reapInterruptedAgentRuns\(/, 'interrupted runs must be reaped');
assert.match(server, /void reapInterruptedAgentRuns\(\)/, 'the reaper must actually run at startup');
{
  const reaper = server.slice(server.indexOf('async function reapInterruptedAgentRuns('), server.indexOf('async function ensureAgentHarnessSchema('));
  for (const table of ['agent_runs', 'agent_turns', 'agent_items']) {
    assert.match(reaper, new RegExp(`from\\('${table}'\\)`), `${table} keeps its own stranded rows and must be swept too`);
  }
  assert.doesNotMatch(reaper, /'waiting_for_user'\s*[,\]]/, 'a run waiting for an answer is resumable and must not be reaped');
}

// And the one legitimate refusal speaks French when asked in French.
assert.match(server, /class HarnessRunActiveError extends Error/, 'an active run is a typed refusal, not a bare string');
assert.doesNotMatch(
  server,
  /throw new Error\('HARNESS_RUN_ACTIVE/,
  'the diagnostic code must not be thrown as the user-facing text again',
);

/*
 * An internal error is not a billing problem.
 *
 * Model routing was wrapped in a catch that answered every exception with
 * `publicCreditGateResponse()` — a provider outage, an unverifiable catalog, a
 * routing bug — so the user was told to upgrade. It logged nothing, carried no
 * diagnostic code and returned HTTP 200. Production shows the result on
 * 2026-09-04 at 16:09: a run that failed in seven seconds, recorded as
 * `turn.failed { diagnostic_code: null }`, with no server log to explain it,
 * on an account holding 27 credits.
 */
{
  const routing = server.slice(server.indexOf('modelRouting = await resolveAgentProviderModel('));
  const handler = routing.slice(0, routing.indexOf('const effectiveModelSelection'));
  assert.match(handler, /console\.error\('\[coden:model_routing_failed\]'/, 'a routing failure must leave a trace');
  assert.match(handler, /diagnoseProviderError\(error\)/, 'and be diagnosed for what it is');
  assert.match(handler, /diagnostic_code: diagnostic\.diagnostic_code/, 'and report that diagnosis');
  assert.match(handler, /insufficientCredits/, 'only a genuine credit refusal may claim credits');
  assert.doesNotMatch(
    handler,
    /return respondJson\(200, \{\s*\.\.\.publicCreditGateResponse\(\)/,
    'an arbitrary exception must not be answered as "upgrade required"',
  );
}

// A credit refusal names itself, in the user's language, with a real status.
{
  const gate = server.slice(server.indexOf('function publicCreditGateResponse('), server.indexOf('function countLineDiffStats('));
  assert.match(gate, /diagnostic_code: 'CREDITS_REQUIRED'/, 'a credit refusal must carry its code');
  assert.doesNotMatch(gate, /error: 'UpgradeRequired'/, 'a diagnostic code is not a message to a user');
  assert.doesNotMatch(gate, /message: 'Upgrade required'/, 'nor is an English fragment, in a French product');
  assert.match(gate, /crédits/, 'the French wording is what most requests get');
  assert.match(gate, /french/, 'and English is available for an English request');
  // Never HTTP 200 for a refusal.
  assert.doesNotMatch(server, /respondJson\(200, publicCreditGateResponse\(/, 'a refusal must not answer with a success status');
  assert.doesNotMatch(server, /respondJson\(200, \{\s*\.\.\.publicCreditGateResponse\(\),?\s*\}\)/, 'nor spread into one');
}

// A run that wrote files but did not verify is a failure the harness can name.
{
  assert.match(
    server,
    /diagnostic_code: 'VERIFICATION_INCOMPLETE'/,
    'an unverified pipeline result must not be recorded as a failure with no cause',
  );
}

console.log('run failure visibility tests passed');
