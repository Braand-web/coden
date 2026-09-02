// Anthropic prompt caching for OpenRouter requests.
//
// The Coden generation system prompt + UI policy + RAG context is large and
// identical across the multi-attempt generation loop and across turns. Marking
// it with cache_control lets Anthropic (via OpenRouter) reuse it at ~10% of the
// input price and far lower latency — a ~80% input-cost cut on Claude models,
// which are the most expensive ones in the catalog.
//
// Caching is a no-op for non-Anthropic adapters (OpenAI/Gemini/DeepSeek caching
// is automatic or differently shaped), so this transform is safe to always run.

export type CacheableContentPart =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  | { type: 'image_url'; image_url: { url: string; detail?: string } };

export type CacheableMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | CacheableContentPart[];
  [key: string]: unknown;
};

export type CachingAdapter = 'anthropic' | 'openai' | 'openrouter' | 'gemini' | 'deepseek' | string;

// Anthropic requires a cached block to be reasonably large to be worth a
// breakpoint (min ~1024 tokens ≈ ~3000 chars). Below this we skip.
const MIN_CACHE_CHARS = 2200;

/** True when this content is long enough to justify a cache breakpoint. */
export function isCacheableSize(text: string): boolean {
  return String(text || '').length >= MIN_CACHE_CHARS;
}

function markPart(text: string): CacheableContentPart {
  return { type: 'text', text, cache_control: { type: 'ephemeral' } };
}

/**
 * True when the request targets a Claude model, whichever adapter carries it.
 *
 * Caching has to follow the model, not the transport. Claude reached through
 * OpenRouter still understands cache_control and still bills the cached prefix
 * at ~10%, but the adapter there is 'openrouter', so keying off the adapter
 * alone silently disabled caching on exactly the path this module was written
 * for — the whole static prompt was re-sent at full price on every call.
 */
export function targetsAnthropicModel(adapter: CachingAdapter, modelId?: string): boolean {
  if (adapter === 'anthropic') return true;
  const id = String(modelId || '');
  return /^anthropic\//i.test(id) || /(^|\/)claude[-.]/i.test(id);
}

/**
 * Returns a new message array with cache_control breakpoints added on the large
 * stable blocks (system prompt, and the first big user context block). At most
 * 4 breakpoints are used (Anthropic's limit). Requests that do not target a
 * Claude model are returned unchanged — OpenAI and Gemini cache automatically
 * and reject or ignore an explicit breakpoint.
 */
export function applyPromptCaching<T extends CacheableMessage>(
  messages: T[],
  adapter: CachingAdapter,
  modelId?: string,
): T[] {
  if (!targetsAnthropicModel(adapter, modelId)) return messages;
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  let breakpoints = 0;
  const MAX_BREAKPOINTS = 4;

  return messages.map(message => {
    if (breakpoints >= MAX_BREAKPOINTS) return message;

    // Only cache the stable context: system prompts and large user context.
    const cacheableRole = message.role === 'system' || message.role === 'user';
    if (!cacheableRole) return message;

    // String content → wrap into a single cached text block when large enough.
    if (typeof message.content === 'string') {
      if (!isCacheableSize(message.content)) return message;
      breakpoints += 1;
      return { ...message, content: [markPart(message.content)] };
    }

    // Array content → add cache_control to the largest text part once.
    if (Array.isArray(message.content)) {
      const textParts = message.content
        .map((part, index) => ({ part, index }))
        .filter(({ part }) => part.type === 'text' && isCacheableSize((part as any).text));
      if (textParts.length === 0) return message;
      // Pick the largest text part for the breakpoint.
      const target = textParts.sort((a, b) => String((b.part as any).text).length - String((a.part as any).text).length)[0];
      breakpoints += 1;
      const nextContent = message.content.map((part, index) =>
        index === target.index && part.type === 'text'
          ? { ...part, cache_control: { type: 'ephemeral' as const } }
          : part,
      );
      return { ...message, content: nextContent as CacheableContentPart[] };
    }

    return message;
  });
}
