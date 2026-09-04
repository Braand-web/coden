import type { ChatCompletionResult, ChatMessage, ToolCall } from './openrouter-service.ts';
import type { ProviderGateway } from './provider-gateway.ts';
import type { ProviderRequestConfig } from './provider-adapters.ts';
import { createNarrationFilter } from './narration-filter.ts';
import { getAgentToolDefinition, toolNeedsApproval } from './agent-tools.ts';

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
    if (index >= cutoff || message.role !== 'tool') return message;
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

function transcriptSize(messages: ChatMessage[]): number {
  let total = 0;
  for (const message of messages) total += String(message.content ?? '').length + 32;
  return total;
}

function safeToolResult(value: unknown) {
  const serialized = JSON.stringify(value ?? null);
  return serialized.length > 16_000 ? `${serialized.slice(0, 16_000)}...` : serialized;
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
    if (Date.now() >= deadline) { stoppedBecause = 'time_budget'; break; }
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
      maxAttempts: 1,
      timeoutMs: input.timeoutMs,
      runtimeConfig: input.runtimeConfig,
      runtimeConfigForModel,
      signal: input.signal,
    };
    result = input.onTextDelta ? await input.gateway.streamingCompletion(input.modelId, messages, {
      ...options,
      allowFallback: false,
      onChunk: accumulated => {
        const delta = filter(accumulated.slice(seen)); seen = accumulated.length;
        if (delta) input.onTextDelta?.(delta);
      },
    }) : await input.gateway.chat(input.modelId, messages, options);
    input.onTextEnd?.();
    promptTokens += result.usage?.prompt_tokens || 0;
    completionTokens += result.usage?.completion_tokens || 0;
    costUsd += result.cost_usd || 0;
    if (!result.tool_calls?.length) return { result, messages, toolExecutions, spend: spend() };

    messages.push({
      role: 'assistant',
      content: result.text || '',
      tool_calls: result.tool_calls,
    });

    input.onToolsStarted?.();
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
            output = await handler(args);
            ok = !(output && typeof output === 'object' && ((output as any).ok === false || (output as any).error));
          }
        } catch (error: any) {
          input.signal?.throwIfAborted();
          output = { error: String(error?.message || 'Tool execution failed.').slice(0, 500) };
        }
      }
      toolExecutions.push({ name: call.function.name, ok, approvalRequired, approved });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: safeToolResult(output),
      });
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
