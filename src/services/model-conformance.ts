/**
 * Proving what a model announces.
 *
 * The catalogue lists a model's modalities and parameters; a listing is a claim.
 * These probes make each claim once, cheaply, and record whether it held:
 * a plain call, streaming, an image, a PDF, a tool call, two tool calls in one
 * turn, each reasoning level, structured JSON, a needle in a long context, and
 * whether a repeated prefix is served from cache. A capability the model does
 * not announce is skipped, with the reason — never assumed, never tried blindly.
 *
 * It is run on demand (admin route) and when a model is first added, not per
 * request. The chat function is injected so the same probes run against the
 * real gateway in production and a scripted fake in tests.
 */
import type { AllowedModelId } from '../config/ai-models.ts';
import type { ChatMessage, ToolCall } from './openrouter-service.ts';
import type { ProviderGateway } from './provider-gateway.ts';
import { buildProviderRequestConfig } from './provider-adapters.ts';
import { buildAIModelRuntimeConfig } from './ai-model-runtime.ts';
import type { ReasoningLevel } from './openrouter-request.ts';
import type { CapabilityCard, ProbeName, ProbeResult } from './model-capability-card.ts';

export type ProbeTool = { name: string; description: string; parameters: Record<string, unknown> };

export type ProbeReply = {
  text: string;
  tool_calls?: ToolCall[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cached_tokens?: number };
};

export type ProbeChat = (modelId: AllowedModelId, messages: ChatMessage[], options?: {
  tools?: ProbeTool[];
  reasoningLevel?: ReasoningLevel;
  stream?: boolean;
  json?: boolean;
}) => Promise<ProbeReply>;

/** A 16×16 solid red PNG (checked with sharp), small enough to embed and unmistakable to read. */
export const PROBE_RED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFklEQVQoz2N4JiJCEmIY1TCqYfhqAABdUg4Q0MqnYgAAAABJRU5ErkJggg==';

/** A one-page PDF whose only text is the token, with a correct cross-reference table. */
export function probePdfBase64(token = 'CODEN-PROBE-7'): string {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    (() => { const stream = `BT /F1 18 Tf 20 50 Td (${token}) Tj ET`; return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`; })(),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1').toString('base64');
}

const user = (content: ChatMessage['content']): ChatMessage => ({ role: 'user', content });

const ECHO_TOOL: ProbeTool = {
  name: 'record_number',
  description: 'Records a number.',
  parameters: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] },
};
const WEATHER_TOOL: ProbeTool = {
  name: 'get_weather',
  description: 'Returns the weather of one city.',
  parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
};

const parseArgs = (call?: ToolCall) => { try { return JSON.parse(call?.function.arguments || '{}'); } catch { return {}; } };

/** A long, boring filler with one fact hidden in it, about `tokens` tokens long. */
export function needleHaystack(tokens: number, needle = 'The access code is TANGERINE-4417.'): string {
  const filler = 'The quarterly report describes routine operations without anything notable to add. ';
  const sentences = Math.max(1, Math.round((tokens * 3.6) / filler.length));
  const at = Math.floor(sentences * 0.62);
  return Array.from({ length: sentences }, (_, index) => (index === at ? needle : filler)).join('');
}

export type ConformanceOptions = {
  modelId: AllowedModelId;
  card: CapabilityCard;
  chat: ProbeChat;
  /** Restrict to these probes. */
  only?: ProbeName[];
  /** Size of the long-context probe; omitted, the probe is skipped (it is the costly one). */
  longContextTokens?: number;
  now?: () => Date;
};

export async function runConformanceProbes(options: ConformanceOptions): Promise<ProbeResult[]> {
  const { modelId, card, chat } = options;
  const now = options.now || (() => new Date());
  const wanted = (name: ProbeName) => !options.only || options.only.includes(name);
  const results: ProbeResult[] = [];

  const run = async (name: ProbeName, skipBecause: string | null, body: () => Promise<{ ok: boolean; detail?: string }>) => {
    if (!wanted(name)) return;
    if (skipBecause) { results.push({ name, status: 'skipped', detail: skipBecause, at: now().toISOString() }); return; }
    const started = Date.now();
    try {
      const outcome = await body();
      results.push({ name, status: outcome.ok ? 'passed' : 'failed', ms: Date.now() - started, detail: outcome.detail, at: now().toISOString() });
    } catch (error: any) {
      results.push({ name, status: 'failed', ms: Date.now() - started, detail: String(error?.message || error).slice(0, 240), at: now().toISOString() });
    }
  };

  await run('simple', null, async () => {
    const reply = await chat(modelId, [user('Reply with exactly the word PONG and nothing else.')]);
    return { ok: /pong/i.test(reply.text), detail: reply.text.slice(0, 60) };
  });

  await run('streaming', null, async () => {
    const reply = await chat(modelId, [user('Reply with exactly the word PONG and nothing else.')], { stream: true });
    return { ok: /pong/i.test(reply.text), detail: reply.text.slice(0, 60) };
  });

  await run('image', card.modalities.input.includes('image') ? null : 'the model does not announce image input', async () => {
    const reply = await chat(modelId, [user([
      { type: 'text', text: 'What single colour fills this image? Answer with one word.' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PROBE_RED_PNG}`, detail: 'low' } },
    ])]);
    return { ok: /red|rouge/i.test(reply.text), detail: reply.text.slice(0, 60) };
  });

  await run('pdf', card.modalities.input.includes('file') ? null : 'the model does not announce file input', async () => {
    const reply = await chat(modelId, [user([
      { type: 'text', text: 'Copy the text of this PDF exactly, nothing else.' },
      { type: 'file', file: { filename: 'probe.pdf', file_data: `data:application/pdf;base64,${probePdfBase64()}` } },
    ])]);
    return { ok: /CODEN-PROBE-7/i.test(reply.text), detail: reply.text.slice(0, 60) };
  });

  await run('tools', card.parameters.tools ? null : 'the model does not announce tool calling', async () => {
    const reply = await chat(modelId, [user('Record the number 42 by calling the tool. Do not answer in text.')], { tools: [ECHO_TOOL] });
    const call = reply.tool_calls?.[0];
    const ok = call?.function.name === 'record_number' && Number(parseArgs(call).n) === 42;
    return { ok, detail: call ? `${call.function.name}(${call.function.arguments.slice(0, 40)})` : 'no tool call' };
  });

  await run('parallel_tools', card.parameters.tools ? null : 'the model does not announce tool calling', async () => {
    const reply = await chat(modelId, [user('What is the weather in Paris and in Lyon? Call the tool once for each city, both in the same turn.')], { tools: [WEATHER_TOOL] });
    const calls = reply.tool_calls || [];
    return { ok: calls.length >= 2, detail: `${calls.length} call(s) in one turn` };
  });

  await run('reasoning', card.parameters.reasoning ? null : 'the model does not announce reasoning control', async () => {
    // Each level is accepted and answered; a level the provider rejects would throw.
    for (const level of ['low', 'high'] as ReasoningLevel[]) {
      const reply = await chat(modelId, [user('What is 17 + 25? Answer with the number only.')], { reasoningLevel: level });
      if (!/42/.test(reply.text)) return { ok: false, detail: `level ${level} answered "${reply.text.slice(0, 40)}"` };
    }
    return { ok: true, detail: 'low and high accepted' };
  });

  await run('json', card.parameters.structuredOutputs || card.parameters.responseFormat ? null : 'the model does not announce structured output', async () => {
    const reply = await chat(modelId, [user('Return a JSON object {"ok": true, "n": 3} and nothing else.')], { json: true });
    try {
      const parsed = JSON.parse(reply.text.trim().replace(/^```(?:json)?|```$/g, ''));
      return { ok: parsed?.ok === true && Number(parsed?.n) === 3, detail: reply.text.slice(0, 60) };
    } catch {
      return { ok: false, detail: `not JSON: ${reply.text.slice(0, 60)}` };
    }
  });

  const longTokens = options.longContextTokens || 0;
  await run('long_context', !longTokens ? 'not requested (the costly probe)' : card.contextLength < longTokens * 1.2 ? 'the context window is smaller than the probe' : null, async () => {
    const reply = await chat(modelId, [user(`${needleHaystack(longTokens)}\n\nWhat is the access code? Answer with the code only.`)]);
    return { ok: /TANGERINE-4417/.test(reply.text), detail: `${longTokens.toLocaleString('en')} tokens; ${reply.text.slice(0, 40)}` };
  });

  await run('prompt_cache', card.pricing?.cacheReadUsdPerMillion ? null : 'the provider announces no cache-read price', async () => {
    const prefix = needleHaystack(2_600);
    const ask = () => chat(modelId, [
      { role: 'system', content: prefix },
      user('Answer with the word OK.'),
    ]);
    await ask();
    const second = await ask();
    const cached = Number(second.usage?.cached_tokens || 0);
    return { ok: cached > 0, detail: `${cached} of ${second.usage?.prompt_tokens ?? '?'} prompt tokens served from cache on the second call` };
  });

  return results;
}

/** The probes' chat function, backed by the real gateway (no fallback: the model under test answers, or fails). */
export function createGatewayProbeChat(gateway: ProviderGateway): ProbeChat {
  return async (modelId, messages, options = {}) => {
    const runtimeConfig = {
      ...buildProviderRequestConfig(buildAIModelRuntimeConfig({
        modelId,
        task: 'debug',
        allowTools: Boolean(options.tools?.length),
        preferStructuredOutput: Boolean(options.json),
        reasoningLevel: options.reasoningLevel,
        stream: Boolean(options.stream),
      })),
      ...(options.tools?.length
        ? { tools: options.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })), toolChoice: 'auto' }
        : {}),
    } as any;
    const request = { maxAttempts: 1, allowFallback: false, runtimeConfig, timeoutMs: 60_000 };
    const result = options.stream
      ? await gateway.streamingCompletion(modelId, messages, { ...request, onChunk: () => undefined })
      : await gateway.chat(modelId, messages, request);
    return { text: result.text, tool_calls: result.tool_calls, usage: result.usage };
  };
}
