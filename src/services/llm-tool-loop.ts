import type { ChatCompletionResult, ChatMessage, ToolCall } from './openrouter-service.ts';
import type { ProviderGateway } from './provider-gateway.ts';
import type { ProviderRequestConfig } from './provider-adapters.ts';
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
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * One model turn, streamed token-by-token when `onToken` is given.
 *
 * Reused unmodified when `onToken` is absent: the exact `gateway.chat(...)`
 * call every existing caller (and every test's duck-typed `{ chat() {} }`
 * stand-in gateway) already relies on. Only a caller that actually wants
 * live tokens pays for `streamChat`, and only such a caller's gateway needs
 * to implement it — real `ProviderGateway` instances always do.
 *
 * `StreamChatEvent`'s `'token'` carries the delta itself, not an
 * accumulated buffer (confirmed against `ProviderGateway.streamingCompletion`'s
 * own `text += event.text` accumulation) — so each event forwards straight
 * to `onToken` with no diffing needed.
 */
async function runOneChatStep(input: {
  gateway: ProviderGateway;
  modelId: string;
  messages: ChatMessage[];
  runtimeConfig?: ProviderRequestConfig;
  runtimeConfigForModel?: (modelId: any) => ProviderRequestConfig | undefined;
  timeoutMs?: number;
  onToken?: (text: string) => void;
}): Promise<ChatCompletionResult> {
  if (!input.onToken) {
    return input.gateway.chat(input.modelId, input.messages, {
      maxAttempts: 1,
      timeoutMs: input.timeoutMs,
      runtimeConfig: input.runtimeConfig,
      runtimeConfigForModel: input.runtimeConfigForModel,
    });
  }

  let text = '';
  let model = input.modelId;
  let usage: ChatCompletionResult['usage'] = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let costUsd = 0;
  let toolCalls: ChatCompletionResult['tool_calls'];

  for await (const event of input.gateway.streamChat(input.modelId, input.messages, {
    timeoutMs: input.timeoutMs,
    runtimeConfig: input.runtimeConfig,
    runtimeConfigForModel: input.runtimeConfigForModel,
  })) {
    model = event.model || model;
    if (event.type === 'token') {
      text += event.text;
      try { input.onToken(event.text); } catch { /* a display concern must never break a run */ }
    }
    if (event.type === 'usage') {
      usage = event.usage;
      costUsd = event.cost_usd;
    }
    if (event.type === 'tool_calls') {
      toolCalls = event.tool_calls as ChatCompletionResult['tool_calls'];
    }
  }

  return { text, model, tool_calls: toolCalls, usage, cost_usd: costUsd };
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
  /** Called with each text fragment as it streams in, for the current step only. */
  onToken?: (text: string) => void;
}): Promise<LlmToolLoopResult> {
  const messages = [...input.messages];
  const toolExecutions: Array<{ name: string; ok: boolean; approvalRequired?: boolean; approved?: boolean }> = [];
  const maxSteps = Math.max(1, Math.min(8, input.maxSteps || 4));
  let result: ChatCompletionResult | null = null;

  for (let step = 0; step < maxSteps; step += 1) {
    result = await runOneChatStep({
      gateway: input.gateway,
      modelId: input.modelId,
      messages,
      runtimeConfig: input.runtimeConfig,
      runtimeConfigForModel: input.runtimeConfigForModel,
      timeoutMs: input.timeoutMs,
      onToken: input.onToken,
    });
    if (!result.tool_calls?.length) return { result, messages, toolExecutions };

    messages.push({
      role: 'assistant',
      content: result.text || '',
      tool_calls: result.tool_calls,
    });

    for (const call of result.tool_calls) {
      const handler = input.handlers[call.function.name];
      const args = parseToolArguments(call.function.arguments);
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
              ok = true;
            }
          } else {
            output = await handler(args);
            ok = true;
          }
        } catch (error: any) {
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
  }

  if (!result) throw new Error('The model tool loop did not produce a response.');
  return { result, messages, toolExecutions };
}
