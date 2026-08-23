import fetch from 'node-fetch';
import type {
  ChatCompletionResult,
  ChatContentPart,
  ChatMessage,
  StreamChatEvent,
  ToolCall,
} from './openrouter-service.ts';
import type { ProviderRequestConfig } from './provider-adapters.ts';

export const ANTHROPIC_API_KEY_ENV_NAMES = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
] as const;

type AnthropicEnv = Record<string, string | undefined>;

export function resolveAnthropicApiKey(env: AnthropicEnv = process.env, fallback = ''): string {
  for (const value of [...ANTHROPIC_API_KEY_ENV_NAMES.map(name => env[name]), fallback]) {
    const clean = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (clean && !clean.includes('***')) return clean;
  }
  return '';
}

const DIRECT_ANTHROPIC_MODEL_IDS: Record<string, string> = {
  'anthropic/claude-sonnet-5': 'claude-sonnet-5',
  'anthropic/claude-opus-5': 'claude-opus-5',
  'anthropic/claude-fable-5': 'claude-fable-5',
};

export function resolveDirectAnthropicModelId(modelId: string): string | null {
  return DIRECT_ANTHROPIC_MODEL_IDS[modelId] || null;
}

type AnthropicServiceConfig = {
  apiKey?: string;
  apiUrl?: string;
  version?: string;
};

export class AnthropicService {
  private config: Required<AnthropicServiceConfig>;

  constructor(config: AnthropicServiceConfig = {}) {
    this.config = {
      apiKey: resolveAnthropicApiKey(process.env, config.apiKey || ''),
      apiUrl: String(config.apiUrl || process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages').trim(),
      version: String(config.version || process.env.ANTHROPIC_API_VERSION || '2023-06-01').trim(),
    };
  }

  isConfigured() {
    return Boolean(resolveAnthropicApiKey(process.env, this.config.apiKey));
  }

  supportsModel(modelId: string) {
    return Boolean(resolveDirectAnthropicModelId(modelId));
  }

  async chat(
    modelId: string,
    messages: ChatMessage[],
    _retryAttempts = 1,
    timeoutMs = 60_000,
    runtimeConfig?: ProviderRequestConfig,
    signal?: AbortSignal,
  ): Promise<ChatCompletionResult> {
    const directModelId = this.requireModel(modelId);
    const response = await this.request(directModelId, messages, runtimeConfig, timeoutMs, false, signal);
    const data: any = await response.json();
    const text = extractText(data?.content);
    const tool_calls = extractToolCalls(data?.content);
    const usage = normalizeUsage(data?.usage);
    return {
      text,
      model: modelId,
      tool_calls: tool_calls.length ? tool_calls : undefined,
      usage,
      cost_usd: estimateAnthropicCost(directModelId, usage.prompt_tokens, usage.completion_tokens),
    };
  }

  async *streamChat(
    modelId: string,
    messages: ChatMessage[],
    timeoutMs = 120_000,
    runtimeConfig?: ProviderRequestConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChatEvent> {
    const directModelId = this.requireModel(modelId);
    const response = await this.request(directModelId, messages, runtimeConfig, timeoutMs, true, signal);
    if (!response.body) throw new Error('Anthropic streaming response body is empty');

    let buffer = '';
    let promptTokens = 0;
    let completionTokens = 0;
    for await (const chunk of response.body as any) {
      buffer += Buffer.from(chunk).toString('utf8');
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';
      for (const frame of frames) {
        const dataLine = frame.split('\n').find(line => line.startsWith('data:'));
        if (!dataLine) continue;
        const raw = dataLine.replace(/^data:\s*/, '').trim();
        if (!raw || raw === '[DONE]') continue;
        let data: any;
        try {
          data = JSON.parse(raw);
        } catch {
          continue;
        }
        if (data?.type === 'error') {
          throw new Error(`Anthropic API Error: ${String(data?.error?.message || 'Streaming request failed')}`);
        }
        if (data?.type === 'message_start') {
          promptTokens = Number(data?.message?.usage?.input_tokens || promptTokens);
        }
        if (data?.type === 'content_block_delta' && data?.delta?.type === 'text_delta' && data?.delta?.text) {
          yield { type: 'token', text: String(data.delta.text), model: modelId };
        }
        if (data?.type === 'message_delta' && data?.usage) {
          completionTokens = Number(data.usage.output_tokens || completionTokens);
        }
        if (data?.type === 'message_stop') {
          const usage = {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          };
          yield {
            type: 'usage',
            model: modelId,
            usage,
            cost_usd: estimateAnthropicCost(directModelId, promptTokens, completionTokens),
          };
        }
      }
    }
  }

  private requireModel(modelId: string) {
    const directModelId = resolveDirectAnthropicModelId(modelId);
    if (!directModelId) throw new Error(`Anthropic direct does not support model ${modelId}`);
    return directModelId;
  }

  private async request(
    directModelId: string,
    messages: ChatMessage[],
    runtimeConfig: ProviderRequestConfig | undefined,
    timeoutMs: number,
    stream: boolean,
    signal?: AbortSignal,
  ) {
    const apiKey = resolveAnthropicApiKey(process.env, this.config.apiKey);
    if (!apiKey) throw new Error('Anthropic API key is not configured.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.config.apiUrl, {
        method: 'POST',
        signal: (signal || controller.signal) as any,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': this.config.version,
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildAnthropicPayload(directModelId, messages, runtimeConfig, stream)),
      });
      if (!response.ok) {
        const raw = await response.text().catch(() => '');
        let message = raw.slice(0, 500);
        try {
          const parsed = JSON.parse(raw);
          message = String(parsed?.error?.message || parsed?.message || message);
        } catch {
          // Keep the bounded provider response.
        }
        throw new Error(`Anthropic HTTP ${response.status}: ${message || response.statusText}`);
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildAnthropicPayload(
  model: string,
  messages: ChatMessage[],
  runtimeConfig: ProviderRequestConfig | undefined,
  stream: boolean,
) {
  const system = messages
    .filter(message => message.role === 'system')
    .map(message => contentToText(message.content))
    .filter(Boolean)
    .join('\n\n');
  const payload: Record<string, unknown> = {
    model,
    max_tokens: Math.max(256, Number(runtimeConfig?.maxTokens || 8192)),
    messages: messages.filter(message => message.role !== 'system').map(toAnthropicMessage),
    stream,
  };
  if (system) payload.system = system;
  const tools = normalizeAnthropicTools(runtimeConfig?.tools || []);
  if (tools.length) {
    payload.tools = tools;
    if (runtimeConfig?.toolChoice === 'auto') payload.tool_choice = { type: 'auto' };
  }
  const supportsExtendedThinking = /claude-(?:sonnet|opus|fable)-5/i.test(model);
  if (supportsExtendedThinking && runtimeConfig?.thinking_budget) {
    payload.thinking = { type: 'enabled', budget_tokens: runtimeConfig.thinking_budget };
  } else if (Number.isFinite(runtimeConfig?.temperature)) {
    payload.temperature = runtimeConfig?.temperature;
  }
  if (runtimeConfig?.responseFormat) {
    payload.system = `${system ? `${system}\n\n` : ''}Return only valid JSON matching the requested response contract.`;
  }
  return payload;
}

function toAnthropicMessage(message: ChatMessage) {
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: message.tool_call_id || message.name || 'tool_result',
        content: contentToText(message.content),
      }],
    };
  }
  const content: any[] = contentToAnthropicBlocks(message.content);
  if (message.role === 'assistant' && message.tool_calls?.length) {
    for (const call of message.tool_calls) {
      let input: unknown = {};
      try {
        input = JSON.parse(call.function.arguments || '{}');
      } catch {
        input = { raw: call.function.arguments || '' };
      }
      content.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
    }
  }
  return { role: message.role === 'assistant' ? 'assistant' : 'user', content };
}

function contentToAnthropicBlocks(content: string | ChatContentPart[]) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content.map(part => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    const url = String(part.image_url?.url || '');
    const dataMatch = url.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (dataMatch) {
      return { type: 'image', source: { type: 'base64', media_type: dataMatch[1], data: dataMatch[2] } };
    }
    return { type: 'image', source: { type: 'url', url } };
  });
}

function contentToText(content: string | ChatContentPart[]) {
  return typeof content === 'string'
    ? content
    : content.filter(part => part.type === 'text').map(part => part.text).join('\n');
}

function normalizeAnthropicTools(tools: Record<string, unknown>[]) {
  return tools.map((tool: any) => {
    if (tool?.name) return tool;
    if (tool?.function?.name) {
      return {
        name: tool.function.name,
        description: tool.function.description || '',
        input_schema: tool.function.parameters || { type: 'object', properties: {} },
      };
    }
    return null;
  }).filter(Boolean);
}

function extractText(content: any[]) {
  return Array.isArray(content)
    ? content.filter(block => block?.type === 'text').map(block => String(block.text || '')).join('')
    : '';
}

function extractToolCalls(content: any[]): ToolCall[] {
  if (!Array.isArray(content)) return [];
  return content.filter(block => block?.type === 'tool_use' && block?.id && block?.name).map(block => ({
    id: String(block.id),
    type: 'function' as const,
    function: {
      name: String(block.name),
      arguments: JSON.stringify(block.input || {}),
    },
  }));
}

function normalizeUsage(usage: any) {
  const prompt_tokens = Number(usage?.input_tokens || 0);
  const completion_tokens = Number(usage?.output_tokens || 0);
  return {
    prompt_tokens,
    completion_tokens,
    total_tokens: prompt_tokens + completion_tokens,
    cached_tokens: Number(usage?.cache_read_input_tokens || 0),
  };
}

function estimateAnthropicCost(model: string, promptTokens: number, completionTokens: number) {
  const rates = /fable-5/i.test(model)
    ? [10, 50]
    : /opus-5/i.test(model)
      ? [5, 25]
      : /opus/i.test(model)
        ? [15, 75]
        : [3, 15];
  return (promptTokens * rates[0] + completionTokens * rates[1]) / 1_000_000;
}
