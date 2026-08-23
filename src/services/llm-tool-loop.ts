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
}): Promise<LlmToolLoopResult> {
  const messages = [...input.messages];
  const toolExecutions: Array<{ name: string; ok: boolean; approvalRequired?: boolean; approved?: boolean }> = [];
  const maxSteps = Math.max(1, Math.min(8, input.maxSteps || 4));
  let result: ChatCompletionResult | null = null;

  for (let step = 0; step < maxSteps; step += 1) {
    result = await input.gateway.chat(input.modelId, messages, {
      maxAttempts: 1,
      timeoutMs: input.timeoutMs,
      runtimeConfig: input.runtimeConfig,
      runtimeConfigForModel: input.runtimeConfigForModel,
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
