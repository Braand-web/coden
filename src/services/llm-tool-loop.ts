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

export type LlmToolLoopResult = {
  result: ChatCompletionResult;
  messages: ChatMessage[];
  toolExecutions: Array<{ name: string; ok: boolean; approvalRequired?: boolean; approved?: boolean }>;
};

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
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
  onTextEnd?: () => void;
  onToolsStarted?: () => void;
  onToolsCompleted?: () => void;
}): Promise<LlmToolLoopResult> {
  const messages = [...input.messages];
  const toolExecutions: Array<{ name: string; ok: boolean; approvalRequired?: boolean; approved?: boolean }> = [];
  const maxSteps = Math.max(1, Math.min(8, input.maxSteps || 4));
  const runtimeConfigForModel = keepCallerTools(input.runtimeConfigForModel, input.runtimeConfig);
  let result: ChatCompletionResult | null = null;

  for (let step = 0; step < maxSteps; step += 1) {
    input.signal?.throwIfAborted();
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
    if (!result.tool_calls?.length) return { result, messages, toolExecutions };

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
      if (toolExecutions.length >= (input.maxToolCalls ?? 48)) {
        input.onToolsCompleted?.();
        return { result, messages, toolExecutions };
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

  if (!result) throw new Error('The model tool loop did not produce a response.');
  return { result, messages, toolExecutions };
}
