import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * A run records how long it took, and what it cost.
 *
 * `agent_runs` declares `duration_ms`, `tokens_in`, `tokens_out` and
 * `real_cost_usd`, and all four are null on every one of the 57 recorded runs.
 * `verification_status` and `facts_count` are written on all 57, so the table
 * is reached — these columns simply never were.
 *
 * The consequence is not cosmetic. "Everything is slow" cannot be answered
 * from the product's own data: there is no measurement to point at. Every
 * answer to that question so far, mine included, has been reasoning about code
 * rather than measurement — which is exactly how the five-day generation
 * outage went unnoticed.
 */

const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

/*
 * The duration is derived where the run ends, not at each call site.
 *
 * There are a dozen terminal calls to `updateAgentRunStatus`. A measurement
 * that depends on each of them remembering to pass a number is a measurement
 * that goes missing again in a month — which is the shape of every capability
 * found unreached in this codebase.
 */
{
  const fn = server.slice(server.indexOf('async function updateAgentRunStatus('), server.indexOf('async function updateAgentRunV3Meta('));

  assert.match(fn, /TERMINAL_RUN_STATUSES\.includes\(status\)/, 'the duration is computed when a run reaches a terminal status');
  assert.match(fn, /select\('created_at'\)/, 'from the row\'s own start time');
  assert.match(fn, /durationMs = finishedAt\.getTime\(\) - startedAt;/, 'as the elapsed time');
  assert.match(fn, /\.\.\.\(durationMs === undefined \? \{\} : \{ duration_ms: durationMs \}\)/, 'and written to the declared column');

  // A caller that already knows better still wins.
  assert.match(fn, /let durationMs = extra\.duration_ms;/, 'an explicit duration is not overwritten');

  /*
   * A clock that ran backwards is not a duration. Leaving it null is honest;
   * a negative number would poison every average built on the column, and the
   * column exists to be averaged.
   */
  assert.match(fn, /finishedAt\.getTime\(\) >= startedAt/, 'a negative elapsed time is never stored');

  // Measurement is an improvement to a run, never a precondition: a failed
  // read must not stop the status from being recorded.
  const guard = fn.slice(fn.indexOf('try {'), fn.indexOf('const update = redactPublicAgentPayload'));
  assert.match(guard, /\} catch \{/, 'a failed measurement must not prevent recording that the run ended');
}

// Cancelled runs are measured too: a run the user stopped at four minutes is
// exactly the kind a latency question is about.
{
  assert.match(server, /const TERMINAL_RUN_STATUSES = \['completed', 'failed', 'cancelled'\];/, 'all three ends count');
}

/*
 * And the cost is recorded from the provider's own report.
 *
 * The credit ledger knows what was charged; the run did not know what it cost.
 * The two could drift with nothing to notice.
 */
{
  const branch = server.slice(server.indexOf("if (decision.intent === 'conversation' || decision.intent === 'clarification_required'"));
  // The completion sits after the charge and after the improvement signal, so
  // the slice runs to the status write itself rather than stopping short.
  const completionAt = branch.indexOf("updateAgentRunStatus(agentRunId, 'completed'");
  assert.ok(completionAt > 0, 'the conversation branch completes its run');
  const completion = branch.slice(completionAt, completionAt + 600);

  assert.match(completion, /real_cost_usd: Number\(agentText\.cost_usd \|\| costRealCostUsd \|\| 0\) \|\| null/, 'the run records what it cost');
  assert.match(completion, /effective_model: agentText\.model \|\| null/, 'and which model actually served it');

  // `|| null` rather than 0: a run whose provider reported nothing has an
  // unknown cost, and zero is a claim that it was free.
  assert.doesNotMatch(completion, /real_cost_usd: Number\([^)]*\),\n/, 'an unknown cost stays unknown rather than becoming zero');
}

console.log('run observability tests passed');
