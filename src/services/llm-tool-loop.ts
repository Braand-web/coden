import type { ChatCompletionResult, ChatMessage, ToolCall } from './openrouter-service.ts';
import type { ProviderGateway } from './provider-gateway.ts';
import type { ProviderRequestConfig } from './provider-adapters.ts';
import { createNarrationFilter } from './narration-filter.ts';
import { getAgentToolDefinition, toolNeedsApproval } from './agent-tools.ts';
import { isDecisionRequiredError } from './agent-decision.ts';

/** Tools that only observe the workspace, safe to run side by side. */
const READ_ONLY_TOOLS = new Set(['read_file', 'list_files', 'search_files', 'get_logs', 'web_search', 'fetch_url']);

export type LlmToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export type ToolApprovalRequest = {
  name: string;
  args: Record<string, unknown>;
  reason: string;
  call: ToolCall;
};

/**
 * What a run may spend, in resources rather than iterations.
 *
 * The loop used to stop at `min(8, maxSteps || 4)` model turns and a fixed
 * tool ceiling, and the coder loop layered three rounds of twelve calls on top
 * — about thirty-six tool calls for a whole application. That is a budget for
 * a minute of work, and the recorded runs show it: a median build finished in
 * 65 seconds because it was not allowed to do more.
 *
 * Iterations are the wrong unit. What actually has to be bounded is the
 * user's time and money, so those are what is counted, and the loop runs until
 * one of them is genuinely spent. `maxSteps` and `maxToolCalls` stay as
 * backstops against a model that loops forever without progressing; they are
 * no longer the thing that ends a normal run.
 */
export type AgentLoopBudget = {
  maxSteps: number;
  maxToolCalls: number;
  maxDurationMs: number;
  /**
   * Transcript size, in characters, above which the oldest tool results are
   * digested. A long run dies on the context window otherwise — which is the
   * reason the ceilings were low in the first place.
   */
  compactAboveChars: number;
};

export const DEFAULT_AGENT_LOOP_BUDGET: AgentLoopBudget = {
  maxSteps: 60,
  maxToolCalls: 200,
  maxDurationMs: 12 * 60_000,
  compactAboveChars: 240_000,
};

/**
 * The least time in which a model call could plausibly succeed.
 *
 * Below this a step is not a chance worth taking, it is a timeout with extra
 * steps — and one that gets blamed on the provider. Deliberately generous:
 * the cost of stopping ten seconds early is a round the run did not need,
 * while the cost of starting a doomed call is a model closed for everyone.
 */
const MIN_VIABLE_CALL_MS = 10_000;

/** What the run actually spent, and what ended it. */
export type AgentLoopSpend = {
  steps: number;
  toolCalls: number;
  elapsedMs: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  compactions: number;
  stoppedBecause: 'answered' | 'step_budget' | 'tool_budget' | 'time_budget';
};

export type LlmToolLoopResult = {
  result: ChatCompletionResult;
  messages: ChatMessage[];
  toolExecutions: Array<{ name: string; ok: boolean; approvalRequired?: boolean; approved?: boolean }>;
  spend: AgentLoopSpend;
};

/**
 * Shrink the transcript without breaking it.
 *
 * Only tool results are digested, and no message is ever removed. Dropping a
 * message would be the obvious way to save more, and it is the one that breaks
 * the request: an assistant message carrying `tool_calls` and the `tool`
 * messages answering it are a matched pair, and a provider rejects either half
 * without the other. Tool output is also where the size actually is — a single
 * file read is worth more characters than every assistant turn combined.
 *
 * The most recent exchanges are left intact, because that is what the model is
 * reasoning about right now; the older ones keep a head and a tail so a path,
 * an error message or a status stays readable.
 */
export function compactTranscript(messages: ChatMessage[], keepRecent = 8, maxKeptChars = 600): ChatMessage[] {
  const cutoff = Math.max(0, messages.length - keepRecent);
  return messages.map((message, index) => {
    if (index >= cutoff) return message;
    /*
     * The model's own old writes, not only the tools' old answers.
     *
     * Only `tool` messages were ever compacted, so every `write_file` the
     * model had issued stayed in the transcript with the whole file as its
     * argument — the largest thing in it, and exactly what the file on disk
     * already holds. A long build grew until it no longer fit. What matters
     * later is that the write happened and where; the content is one
     * read_file away.
     */
    if (message.role === 'assistant' && message.tool_calls?.length) {
      return { ...message, tool_calls: message.tool_calls.map(compactToolCallArguments) };
    }
    if (message.role !== 'tool') return message;
    const content = String(message.content ?? '');
    if (content.length <= maxKeptChars) return message;
    const head = content.slice(0, Math.floor(maxKeptChars * 0.7));
    const tail = content.slice(-Math.floor(maxKeptChars * 0.2));
    return {
      ...message,
      content: `${head}\n…[${content.length - head.length - tail.length} characters of this earlier result were compacted]…\n${tail}`,
    };
  });
}

function compactToolCallArguments(call: NonNullable<ChatMessage['tool_calls']>[number]) {
  const raw = call.function.arguments || '';
  if (raw.length <= 800) return call;
  let args: Record<string, unknown>;
  try { args = JSON.parse(raw); } catch { return call; }
  const compacted = Object.fromEntries(Object.entries(args).map(([key, value]) => [
    key,
    typeof value === 'string' && value.length > 400 ? `[${value.length} characters, already applied — read the file for its current content]` : value,
  ]));
  return { ...call, function: { ...call.function, arguments: JSON.stringify(compacted) } };
}

/**
 * A finished round's transcript, made safe to continue from.
 *
 * The loop can stop between an assistant's tool calls and their results (a
 * spent budget, the deadline), and a provider rejects a transcript in which a
 * tool call has no result. Every unanswered call gets one that says it did
 * not run; the system message is dropped, since the next round brings its
 * own; and the round's final answer, which the loop returns separately, is
 * put back where it was said.
 */
export function carryOverTranscript(messages: ChatMessage[], finalText?: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  const body = messages.filter(message => message.role !== 'system');
  for (let index = 0; index < body.length; index += 1) {
    const message = body[index];
    if (message.role === 'tool') {
      const owner = [...out].reverse().find(item => item.role === 'assistant' && item.tool_calls?.length);
      if (!owner?.tool_calls?.some(call => call.id === message.tool_call_id)) continue;
      out.push(message);
      continue;
    }
    // Close the previous assistant turn's unanswered calls before anything else is said.
    closeOpenCalls(out);
    out.push(message);
  }
  closeOpenCalls(out);
  const text = String(finalText || '').trim();
  const last = out.at(-1);
  if (text && !(last?.role === 'assistant' && !last.tool_calls?.length && String(last.content || '').trim() === text)) {
    out.push({ role: 'assistant', content: text });
  }
  // A transcript opens on the user, never on an answer.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

function closeOpenCalls(out: ChatMessage[]) {
  let ownerIndex = -1;
  for (let index = out.length - 1; index >= 0; index -= 1) {
    if (out[index].role === 'tool') continue;
    if (out[index].role === 'assistant' && out[index].tool_calls?.length) ownerIndex = index;
    break;
  }
  if (ownerIndex < 0) return;
  const answered = new Set(out.slice(ownerIndex + 1).filter(item => item.role === 'tool').map(item => item.tool_call_id));
  for (const call of out[ownerIndex].tool_calls || []) {
    if (!answered.has(call.id)) {
      out.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: 'Not executed: the previous round ended before this call ran.' }) });
    }
  }
}

function transcriptSize(messages: ChatMessage[]): number {
  let total = 0;
  for (const message of messages) total += String(message.content ?? '').length + 32;
  return total;
}

function safeToolResult(value: unknown) {
  const serialized = JSON.stringify(value ?? null);
  if (serialized.length <= 80_000) return serialized;
  return JSON.stringify({ ok: false, truncated: true, error: 'TOOL_RESULT_TOO_LARGE',
    hint: 'Request a smaller file range or a more specific search. This result is not complete.',
    preview: serialized.slice(0, 12_000), originalChars: serialized.length });
}

function parseToolArguments(raw: string | undefined) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid tool arguments');
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('MODEL_TOOL_ARGUMENTS_INVALID: Tool arguments must be a valid JSON object.');
  }
}

/**
 * Keep the caller's own tools on every candidate model.
 *
 * `ProviderGateway` resolves a request's config as
 * `runtimeConfigForModel?.(candidate) || runtimeConfig` — the per-model
 * config wins outright. A caller that passes both (every real caller does:
 * `buildToolLoopTurn` in multi-agent-pipeline.ts, and the sandbox-repair
 * block in server.ts) therefore had the explicit tool list backing
 * `handlers` silently replaced by whatever generic tools the per-model
 * config happened to carry — advisory things like `inspect_project_files`,
 * never `write_file`. The model was told it works through tools, found none
 * that could write, and printed the whole application as text instead.
 *
 * Per-model shaping is still the caller's (formats, limits, reasoning); the
 * tool list is this loop's, because it is the half that owns the handlers
 * those tools resolve to. A fallback model must be able to call exactly what
 * the primary could.
 */
function keepCallerTools(
  perModel: ((modelId: any) => ProviderRequestConfig | undefined) | undefined,
  explicit: ProviderRequestConfig | undefined,
) {
  if (!perModel || !explicit?.tools?.length) return perModel;
  return (modelId: any) => {
    const base = perModel(modelId);
    if (!base) return base;
    return { ...base, tools: explicit.tools, toolChoice: explicit.toolChoice ?? 'auto' };
  };
}

export async function runLlmToolLoop(input: {
  gateway: ProviderGateway;
  modelId: string;
  messages: ChatMessage[];
  handlers: Record<string, LlmToolHandler>;
  runtimeConfig?: ProviderRequestConfig;
  runtimeConfigForModel?: (modelId: any) => ProviderRequestConfig | undefined;
  approvalResolver?: (request: ToolApprovalRequest) => Promise<boolean> | boolean;
  sensitiveTools?: Record<string, { needsApproval: boolean; reason?: string }>;
  timeoutMs?: number;
  maxSteps?: number;
  maxToolCalls?: number;
  /** Retry transient failures on the selected model before ending the run. */
  maxModelAttempts?: number;
  /** Cross-model recovery is allowed only when the caller represents Auto. */
  allowFallback?: boolean;
  /** Resource budget for this loop. Anything omitted takes the default. */
  budget?: Partial<AgentLoopBudget>;
  /**
   * An absolute moment this run must not pass, shared across every call.
   *
   * `maxDurationMs` bounds one invocation, and the coder loop invokes this
   * once per round — so eight rounds of a twelve-minute budget is ninety-six
   * minutes, which is not a budget at all. A caller that spans several rounds
   * computes the deadline once and passes it to all of them.
   */
  deadline?: number;
  /** Called when the transcript is digested, so a caller can report it. */
  onCompacted?: (info: { chars: number }) => void;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
  /** The model's reasoning, as it streams. Shown in a collapsible block. */
  onReasoningDelta?: (delta: string) => void;
  onTextEnd?: () => void;
  onToolsStarted?: () => void;
  onToolsCompleted?: () => void;
}): Promise<LlmToolLoopResult> {
  let messages = [...input.messages];
  const toolExecutions: Array<{ name: string; ok: boolean; approvalRequired?: boolean; approved?: boolean }> = [];
  const budget: AgentLoopBudget = { ...DEFAULT_AGENT_LOOP_BUDGET, ...input.budget };
  // The older per-call arguments still win where a caller sets them, so no
  // existing caller changes behaviour by upgrading.
  const maxSteps = Math.max(1, input.maxSteps ?? budget.maxSteps);
  const maxToolCalls = Math.max(1, input.maxToolCalls ?? budget.maxToolCalls);
  const startedAt = Date.now();
  const deadline = Math.min(
    startedAt + budget.maxDurationMs,
    Number.isFinite(input.deadline) ? (input.deadline as number) : Number.POSITIVE_INFINITY,
  );
  const runtimeConfigForModel = keepCallerTools(input.runtimeConfigForModel, input.runtimeConfig);
  let result: ChatCompletionResult | null = null;
  let compactions = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd = 0;
  let steps = 0;
  let stoppedBecause: AgentLoopSpend['stoppedBecause'] = 'answered';
  const spend = (): AgentLoopSpend => ({
    steps,
    toolCalls: toolExecutions.length,
    elapsedMs: Date.now() - startedAt,
    promptTokens,
    completionTokens,
    costUsd,
    compactions,
    stoppedBecause,
  });

  for (let step = 0; step < maxSteps; step += 1) {
    input.signal?.throwIfAborted();
    /*
     * Stop with time left, rather than spending the remainder on a call that
     * cannot finish.
     *
     * The guard used to be `>= deadline`, so a step starting with eight
     * hundred milliseconds left went ahead anyway — and the timeout handed to
     * the provider below is whatever remains, so it timed out by construction.
     * That is not a provider failure, but it was classified as one
     * (`PROVIDER_TIMEOUT`, `retryable: true`) and counted against the model's
     * circuit breaker. Three runs reaching their own budget were enough to
     * close a model for every user of the process.
     *
     * A run out of time now says so, which is both true and free.
     */
    if (deadline - Date.now() < MIN_VIABLE_CALL_MS) { stoppedBecause = 'time_budget'; break; }
    steps = step + 1;

    // Compacted before the call, not after: the request about to be sent is
    // what has to fit.
    const size = transcriptSize(messages);
    if (size > budget.compactAboveChars) {
      const compacted = compactTranscript(messages);
      const reclaimed = size - transcriptSize(compacted);
      // A transcript can be over the threshold and still have nothing old
      // enough to digest — a handful of very large recent results, which must
      // be kept whole. Counting that as a compaction would report work that
      // did not happen, and hide the fact that the run is near its limit with
      // no room left to reclaim.
      if (reclaimed > 0) {
        messages = compacted;
        compactions += 1;
        input.onCompacted?.({ chars: reclaimed });
      }
    }
    const filter = createNarrationFilter();
    let seen = 0;
    const options = {
      maxAttempts: Math.max(1, input.maxModelAttempts ?? 2),
      timeoutMs: Math.max(1, Math.min(input.timeoutMs ?? Infinity, deadline - Date.now())),
      runtimeConfig: input.runtimeConfig,
      runtimeConfigForModel,
      allowFallback: input.allowFallback === true,
      signal: input.signal,
    };
    result = input.onTextDelta ? await input.gateway.streamingCompletion(input.modelId, messages, {
      ...options,
      onChunk: accumulated => {
        const delta = filter(accumulated.slice(seen)); seen = accumulated.length;
        if (delta) input.onTextDelta?.(delta);
      },
      ...(input.onReasoningDelta ? { onReasoningChunk: input.onReasoningDelta } : {}),
    }) : await input.gateway.chat(input.modelId, messages, options);
    input.onTextEnd?.();
    promptTokens += result.usage?.prompt_tokens || 0;
    completionTokens += result.usage?.completion_tokens || 0;
    costUsd += result.cost_usd || 0;
    if (Date.now() >= deadline) { stoppedBecause = 'time_budget'; break; }
    if (!result.tool_calls?.length) return { result, messages, toolExecutions, spend: spend() };

    messages.push({
      role: 'assistant',
      content: result.text || '',
      tool_calls: result.tool_calls,
      // Handed back so a reasoning model continues its chain after the tools.
      ...(result.reasoning_details?.length ? { reasoning_details: result.reasoning_details } : {}),
    });
    const assistantIndex = messages.length - 1;
    const applied = new Set<string>();

    input.onToolsStarted?.();
    /*
     * Reads run together.
     *
     * A model that opens a round by asking for six files waited for them one
     * after another, each a filesystem round trip plus the harness record.
     * The reads at the head of a batch — before any write can change what
     * they would see — start at once here, and the sequential loop below
     * picks up their results in order, so the transcript is identical.
     */
    const prefetched = new Map<string, Promise<{ output: unknown; threw?: unknown }>>();
    const readBudget = Math.max(0, maxToolCalls - toolExecutions.length);
    for (const call of result.tool_calls) {
      const name = call.function.name;
      const handler = input.handlers[name];
      if (!READ_ONLY_TOOLS.has(name) || !handler || input.sensitiveTools?.[name] || prefetched.size >= readBudget) break;
      let args: Record<string, unknown>;
      try { args = parseToolArguments(call.function.arguments); } catch { break; }
      if (toolNeedsApproval(name, args)) break;
      prefetched.set(call.id, Promise.resolve().then(() => handler(args)).then(output => ({ output }), threw => ({ output: undefined, threw })));
    }
    for (const call of result.tool_calls) {
      input.signal?.throwIfAborted();
      const handler = input.handlers[call.function.name];
      /*
       * The tool ceiling ends the loop; it does not fail the run.
       *
       * Throwing here killed generation outright: the coder loop passes its
       * own per-round budget as `maxToolCalls`, and a real build spends that
       * within the first round — read a few files, write a few, install a
       * dependency. The throw escaped the turn, the round and the pipeline,
       * and the route answered 502 with the bare string `TOOL_BUDGET_EXCEEDED`.
       *
       * A spent budget is a stopping condition, not an error, and this loop
       * already has one: running out of `maxSteps` falls out of the loop and
       * returns what the run produced. This does the same, so the caller
       * still gets its messages and executions, and `runCoderLoop` goes on to
       * validate the files that were written and open the next round.
       */
      if (toolExecutions.length >= maxToolCalls) {
        stoppedBecause = 'tool_budget';
        input.onToolsCompleted?.();
        return { result, messages, toolExecutions, spend: spend() };
      }
      if (Date.now() >= deadline) {
        stoppedBecause = 'time_budget';
        input.onToolsCompleted?.();
        return { result, messages, toolExecutions, spend: spend() };
      }
      let args: Record<string, unknown>;
      try { args = parseToolArguments(call.function.arguments); }
      catch (error) {
        toolExecutions.push({ name: call.function.name, ok: false });
        messages.push({ role:'tool', tool_call_id:call.id, content:String(error) });
        continue;
      }
      let output: unknown;
      let ok = false;
      let approvalRequired = false;
      let approved: boolean | undefined;
      if (!handler) {
        output = { error: 'Tool is not available.' };
      } else {
        try {
          const sensitiveTool = input.sensitiveTools?.[call.function.name];
          const internalTool = getAgentToolDefinition(call.function.name);
          approvalRequired = Boolean(sensitiveTool?.needsApproval) || toolNeedsApproval(call.function.name, args);
          if (approvalRequired) {
            const reason = sensitiveTool?.reason
              || internalTool?.approvalReason
              || 'This tool can perform a sensitive operation and requires explicit approval.';
            approved = input.approvalResolver
              ? Boolean(await input.approvalResolver({ name: call.function.name, args, reason, call }))
              : false;
            if (!approved) {
              output = {
                error: 'Tool execution requires explicit approval.',
                diagnostic_code: 'TOOL_APPROVAL_REQUIRED',
                needsApproval: true,
                tool: call.function.name,
                reason,
              };
            } else {
              output = await handler(args);
              ok = !(output && typeof output === 'object' && ((output as any).ok === false || (output as any).error));
            }
          } else {
            const early = prefetched.get(call.id);
            if (early) {
              const settled = await early;
              if (settled.threw) throw settled.threw;
              output = settled.output;
            } else {
              output = await handler(args);
            }
            ok = !(output && typeof output === 'object' && ((output as any).ok === false || (output as any).error));
          }
        } catch (error: any) {
          input.signal?.throwIfAborted();
          /*
           * A decision is a stopping condition, not a tool that broke.
           *
           * Everything else caught here is handed back to the model as a tool
           * result, which is right for a failure it can work around. A request
           * for a decision has to leave the loop: fed back, the model would
           * read "tool execution failed", try something else, and the run
           * would carry on past the very point it said it could not pass.
           */
          if (isDecisionRequiredError(error)) throw error;
          output = { error: String(error?.message || 'Tool execution failed.').slice(0, 500) };
        }
      }
      toolExecutions.push({ name: call.function.name, ok, approvalRequired, approved });
      if (ok) applied.add(call.id);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: safeToolResult(output),
      });
    }
    /*
     * A write is on disk the moment it succeeds; its body need not ride along.
     *
     * Every later step re-sent the whole transcript, and a successful
     * `write_file` kept the entire file in it as the call's argument — about
     * 6,000 characters per component, re-sent on every step after it. A
     * fourteen-file build sent some 300,000 input tokens, most of them files
     * the model had already written and could read back in one call. Stubbed
     * here, once, right after the step: the transcript stays append-only, so
     * the prompt prefix a provider caches is not disturbed later.
     */
    if (applied.size) {
      const owner = messages[assistantIndex];
      if (owner?.role === 'assistant' && owner.tool_calls?.length) {
        messages[assistantIndex] = { ...owner, tool_calls: owner.tool_calls.map(call => applied.has(call.id) ? compactToolCallArguments(call) : call) };
      }
    }
    input.onToolsCompleted?.();
  }

  /*
   * Out of time before the first call is an outcome, not a crash.
   *
   * A later coder round inherits the run's shared deadline, and if the earlier
   * rounds spent it this loop stops before calling anything. Throwing there
   * sent a bare "did not produce a response" up through the round, the
   * pipeline and the route — the same shape of failure as a spent tool budget
   * once did. It reports an empty answer instead, and `stoppedBecause` says
   * why, so the caller keeps the files the earlier rounds wrote.
   */
  if (!result) {
    if (stoppedBecause !== 'time_budget') throw new Error('The model tool loop did not produce a response.');
    return {
      result: { text: '', model: input.modelId, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, cost_usd: 0 },
      messages,
      toolExecutions,
      spend: spend(),
    };
  }
  if (stoppedBecause === 'answered') stoppedBecause = 'step_budget';
  return { result, messages, toolExecutions, spend: spend() };
}
