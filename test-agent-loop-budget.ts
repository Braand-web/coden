import assert from 'node:assert/strict';
import { compactTranscript, runLlmToolLoop, DEFAULT_AGENT_LOOP_BUDGET } from './src/services/llm-tool-loop.ts';
import { CodenAgentHarness, InMemoryAgentHarnessStore } from './src/services/agent-harness/index.ts';

/*
 * The measured gap with a generalist coding agent was never the tool surface —
 * this loop has list, read, search, write, edit, delete, install and run. It
 * was how long the loop is allowed to think.
 *
 * `min(8, maxSteps || 4)` model turns, twelve tool calls a round, three
 * rounds: about thirty-six tool calls for an entire application. The recorded
 * runs show the consequence directly — a median build finishing in 65 seconds,
 * because it was not permitted to do more.
 *
 * Iterations were the wrong unit. Time and money are what have to be bounded.
 */

const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

function scriptedGateway(script: Array<{ text?: string; tools?: string[] }>) {
  let call = 0;
  return {
    calls: () => call,
    async chat() {
      const step = script[Math.min(call, script.length - 1)];
      call += 1;
      return {
        text: step.text || '',
        model: 'test',
        usage,
        cost_usd: 0.001,
        tool_calls: step.tools?.map((name, index) => ({
          id: `call_${call}_${index}`,
          type: 'function' as const,
          function: { name, arguments: '{"path":"src/App.tsx"}' },
        })),
      };
    },
  };
}

// A run that answers reports what it spent, and why it stopped.
{
  const gateway = scriptedGateway([{ tools: ['read_file'] }, { text: 'done' }]);
  const result = await runLlmToolLoop({
    gateway: gateway as any,
    modelId: 'test',
    messages: [{ role: 'user', content: 'build it' }],
    handlers: { read_file: async () => ({ ok: true, content: 'x' }) },
  });
  assert.equal(result.spend.stoppedBecause, 'answered');
  assert.equal(result.spend.toolCalls, 1);
  assert.equal(result.spend.steps, 2);
  assert.equal(result.spend.promptTokens, 20, 'token spend is accumulated across turns');
  assert.ok(result.spend.costUsd > 0, 'and so is cost');
  assert.ok(result.spend.elapsedMs >= 0);
}

// The ceiling is far above what one round used to get.
{
  assert.ok(DEFAULT_AGENT_LOOP_BUDGET.maxToolCalls >= 100, 'a real build needs more than a dozen tool calls');
  assert.ok(DEFAULT_AGENT_LOOP_BUDGET.maxSteps >= 30, 'and more than a handful of model turns');
  assert.ok(DEFAULT_AGENT_LOOP_BUDGET.maxDurationMs >= 5 * 60_000, 'bounded by time, which is the real cost');
}

// A model that never stops calling tools is stopped by the tool backstop,
// and says so rather than looking like it answered.
{
  const gateway = scriptedGateway([{ tools: ['read_file'] }]);
  const result = await runLlmToolLoop({
    gateway: gateway as any,
    modelId: 'test',
    messages: [{ role: 'user', content: 'loop forever' }],
    handlers: { read_file: async () => ({ ok: true }) },
    budget: { maxToolCalls: 3 },
  });
  assert.equal(result.spend.stoppedBecause, 'tool_budget');
  assert.equal(result.spend.toolCalls, 3);
}

// And by the clock, which is what ends a normal long run.
{
  const gateway = scriptedGateway([{ tools: ['read_file'] }]);
  const result = await runLlmToolLoop({
    gateway: gateway as any,
    modelId: 'test',
    messages: [{ role: 'user', content: 'slow' }],
    handlers: { read_file: async () => { await new Promise(resolve => setTimeout(resolve, 20)); return { ok: true }; } },
    budget: { maxDurationMs: 30 },
  });
  assert.equal(result.spend.stoppedBecause, 'time_budget');
}

/*
 * Compaction is what makes a long run possible at all: without it the
 * transcript outgrows the context window, which is why the ceilings were low.
 */
{
  const long = 'x'.repeat(5_000);
  const messages = [
    { role: 'system' as const, content: 'you build applications' },
    { role: 'user' as const, content: 'build a todo list' },
    ...Array.from({ length: 12 }, (_, index) => ({
      role: 'tool' as const,
      tool_call_id: `call_${index}`,
      name: 'read_file',
      content: `${index}:${long}`,
    })),
  ];

  const compacted = compactTranscript(messages, 4);
  assert.equal(compacted.length, messages.length, 'no message is ever removed — a tool result without its call is rejected');
  assert.equal(compacted[0].content, messages[0].content, 'the system prompt is untouched');
  assert.equal(compacted[1].content, messages[1].content, 'so is the request');
  for (let index = messages.length - 4; index < messages.length; index += 1) {
    assert.equal(compacted[index].content, messages[index].content, 'the most recent results are what the model is reasoning about');
  }
  const oldest = String(compacted[2].content);
  assert.ok(oldest.length < 5_000, 'an old result is digested');
  assert.match(oldest, /compacted/, 'and says so, rather than looking truncated by accident');
  assert.match(oldest, /^0:/, 'its head survives, so a path or an error stays readable');
  // The recent messages are deliberately kept whole, so the saving is measured
  // on the part that was actually eligible.
  const olderBefore = messages.slice(2, messages.length - 4).reduce((total, message) => total + String(message.content).length, 0);
  const olderAfter = compacted.slice(2, compacted.length - 4).reduce((total, message) => total + String(message.content).length, 0);
  assert.ok(olderAfter < olderBefore / 5, `the older results must shrink hard: ${olderBefore} -> ${olderAfter}`);
  assert.ok(JSON.stringify(compacted).length < JSON.stringify(messages).length / 2, 'and the whole transcript roughly halves');
}

// Compaction runs by itself once the transcript is large, and is reported.
{
  const big = 'y'.repeat(8_000);
  const gateway = scriptedGateway([
    ...Array.from({ length: 14 }, () => ({ tools: ['read_file'] })),
    { text: 'done' },
  ]);
  const compactions: number[] = [];
  const result = await runLlmToolLoop({
    gateway: gateway as any,
    modelId: 'test',
    messages: [{ role: 'user', content: 'build it' }],
    handlers: { read_file: async () => ({ ok: true, content: big }) },
    budget: { compactAboveChars: 40_000, maxSteps: 16 },
    onCompacted: info => compactions.push(info.chars),
  });
  assert.ok(result.spend.compactions >= 1, 'a large transcript must be compacted rather than sent whole');
  assert.ok(compactions[0] > 0, 'and the caller is told how much was reclaimed');
  assert.ok(result.spend.toolCalls >= 10, 'the run keeps going past the point the old ceiling stopped it');
}

/*
 * A transcript can be over the threshold with nothing old enough to digest —
 * a couple of very large recent results, which must be kept whole. Reporting a
 * compaction there would claim work that did not happen, and hide that the run
 * is near its limit with no room left to reclaim.
 */
{
  const huge = 'z'.repeat(60_000);
  const gateway = scriptedGateway([{ tools: ['read_file'] }, { text: 'done' }]);
  const compactions: number[] = [];
  const result = await runLlmToolLoop({
    gateway: gateway as any,
    modelId: 'test',
    messages: [{ role: 'user', content: 'build it' }],
    handlers: { read_file: async () => ({ ok: true, content: huge }) },
    budget: { compactAboveChars: 10_000 },
    onCompacted: info => compactions.push(info.chars),
  });
  assert.equal(result.spend.compactions, 0, 'nothing was reclaimed, so nothing is reported as reclaimed');
  assert.equal(compactions.length, 0);
}

// The harness records what was spent, accumulating across rounds.
{
  const harness = new CodenAgentHarness(new InMemoryAgentHarnessStore());
  const thread = await harness.createThread({ organizationId: 'org', projectId: 'project', userId: 'user', title: 'demo' });
  const { turn } = await harness.createTurn({
    threadId: thread.id, userId: 'user', prompt: 'build', requestedMode: 'auto', idempotencyKey: 'budget-test',
  });
  assert.equal(turn.budgetUsed.toolCalls, 0);

  await harness.recordSpend(turn.id, { toolCalls: 14, repairAttempts: 1, credits: 0.02 });
  const after = await harness.recordSpend(turn.id, { toolCalls: 9, repairAttempts: 1, credits: 0.01 });

  assert.equal(after.budgetUsed.toolCalls, 23, 'rounds accumulate, they do not overwrite');
  assert.equal(after.budgetUsed.repairAttempts, 2);
  assert.ok(Math.abs(after.budgetUsed.credits - 0.03) < 1e-9);
}

// And the pipeline must actually report it, per round.
{
  const { readFileSync } = await import('node:fs');
  const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
  assert.match(pipeline, /ctx\.harness\.recordSpend\(ctx\.turnId/, 'the run must record what it spends');
  assert.match(pipeline, /onSpend: roundSpend =>/, 'from the loop that actually spent it');
  assert.doesNotMatch(pipeline, /maxSteps: Math\.min\(6, maxToolCalls\)/, 'the six-turn cap must not come back');
}

// The coder loop's own ceilings are backstops now, not the budget.
{
  const { readFileSync } = await import('node:fs');
  const repair = readFileSync(new URL('./src/services/sandbox/repair-loop.ts', import.meta.url), 'utf8');
  const rounds = Number(/const DEFAULT_MAX_ROUNDS = (\d+)/.exec(repair)?.[1]);
  const calls = Number(/const DEFAULT_MAX_TOOL_CALLS = (\d+)/.exec(repair)?.[1]);
  assert.ok(rounds >= 6, `a build needs more than ${rounds} rounds`);
  assert.ok(calls >= 30, `and more than ${calls} tool calls per round`);
  assert.ok(rounds * calls >= 200, 'the total ceiling must be an order of magnitude above the old 36');
}

/*
 * One clock for the whole run, not one per round.
 *
 * `maxDurationMs` bounds a single invocation, and the coder loop invokes this
 * once per round — so eight rounds of a twelve-minute budget is ninety-six
 * minutes, which is not a budget. A caller spanning several rounds computes
 * the deadline once and every round shares it.
 */
{
  const gateway = scriptedGateway([{ tools: ['read_file'] }]);
  const result = await runLlmToolLoop({
    gateway: gateway as any,
    modelId: 'test',
    messages: [{ role: 'user', content: 'go' }],
    handlers: { read_file: async () => ({ ok: true }) },
    // Already spent: a later round inherits a deadline that has passed.
    deadline: Date.now() - 1,
  });
  assert.equal(result.spend.stoppedBecause, 'time_budget');
  assert.equal(result.spend.toolCalls, 0, 'a run out of time must not start another tool call');
}

// The earlier of the two bounds wins, whichever it is.
{
  const gateway = scriptedGateway([{ tools: ['read_file'] }]);
  const result = await runLlmToolLoop({
    gateway: gateway as any,
    modelId: 'test',
    messages: [{ role: 'user', content: 'go' }],
    handlers: { read_file: async () => { await new Promise(resolve => setTimeout(resolve, 20)); return { ok: true }; } },
    budget: { maxDurationMs: 25 },
    deadline: Date.now() + 60_000,
  });
  assert.equal(result.spend.stoppedBecause, 'time_budget', 'the per-invocation budget still applies under a distant deadline');
}

// And the pipeline must give every round the same deadline.
{
  const { readFileSync } = await import('node:fs');
  const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
  assert.match(pipeline, /const runDeadline = Date\.now\(\)/, 'the run computes its deadline once');
  assert.match(pipeline, /deadline: runDeadline/, 'and hands it to the coder rounds');
  assert.match(pipeline, /deadline: input\.deadline/, 'which passes it down to the loop');
}

console.log('agent loop budget tests passed');
