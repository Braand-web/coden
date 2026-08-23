// Tool-call stream accumulator.
//
// OpenRouter / OpenAI streams tool calls as fragmented deltas:
//   delta.tool_calls: [{ index: 0, id?, function: { name?, arguments? } }]
// The `arguments` JSON string is split across many SSE chunks. This pure
// accumulator stitches the fragments back into complete tool calls, indexed by
// the `index` field so concurrent calls (parallel tool calling) merge correctly.
// Anthropic-style messages (single shot, full input on the message object) are
// also accepted via collectFromMessageToolCalls().

export type StreamToolCallDelta = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

export type AssembledToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export class ToolCallStreamAccumulator {
  private byIndex = new Map<number, AssembledToolCall>();
  private nextSyntheticIndex = 0;

  /** Apply one delta from a streaming choice. Safe with partial fields. */
  ingestDelta(delta: StreamToolCallDelta): void {
    const index = typeof delta.index === 'number' ? delta.index : this.nextSyntheticIndex++;
    const existing = this.byIndex.get(index) || {
      id: '',
      type: 'function' as const,
      function: { name: '', arguments: '' },
    };
    if (delta.id) existing.id = delta.id;
    if (delta.function?.name) existing.function.name = delta.function.name;
    if (typeof delta.function?.arguments === 'string') {
      existing.function.arguments += delta.function.arguments;
    }
    this.byIndex.set(index, existing);
  }

  /** Convenience: ingest a whole `delta.tool_calls` array. */
  ingestDeltaArray(deltas: StreamToolCallDelta[] | undefined | null): void {
    if (!Array.isArray(deltas)) return;
    for (const delta of deltas) this.ingestDelta(delta);
  }

  /** True if any tool call has been collected. */
  hasCalls(): boolean {
    return this.byIndex.size > 0;
  }

  /** True if every collected call has a complete, parseable arguments JSON. */
  hasCompleteCalls(): boolean {
    if (this.byIndex.size === 0) return false;
    for (const call of this.byIndex.values()) {
      if (!call.function.name) return false;
      if (!isCompleteJson(call.function.arguments)) return false;
    }
    return true;
  }

  /** Final list ordered by index. Drops entries that never received a name. */
  finalize(): AssembledToolCall[] {
    const out: AssembledToolCall[] = [];
    const sortedIndices = Array.from(this.byIndex.keys()).sort((a, b) => a - b);
    for (const idx of sortedIndices) {
      const call = this.byIndex.get(idx)!;
      if (!call.function.name) continue;
      if (!call.id) call.id = `call_${idx}`;
      out.push(call);
    }
    return out;
  }
}

/** True when `value` is a valid, complete JSON document. */
export function isCompleteJson(value: string): boolean {
  const text = String(value || '').trim();
  if (!text) return true; // a tool with no args is fine
  try { JSON.parse(text); return true; } catch { return false; }
}

/**
 * Anthropic and the non-streaming OpenAI path put the whole tool calls on the
 * message. This helper produces the same AssembledToolCall[] shape so the
 * runtime can consume both paths identically.
 */
export function collectFromMessageToolCalls(message: any): AssembledToolCall[] {
  if (!message) return [];
  // OpenAI-shaped tool_calls.
  if (Array.isArray(message.tool_calls)) {
    return message.tool_calls
      .map((call: any, i: number) => ({
        id: String(call?.id || `call_${i}`),
        type: 'function' as const,
        function: {
          name: String(call?.function?.name || ''),
          arguments: typeof call?.function?.arguments === 'string'
            ? call.function.arguments
            : JSON.stringify(call?.function?.arguments || {}),
        },
      }))
      .filter((c: AssembledToolCall) => c.function.name);
  }
  // Anthropic-shaped content blocks.
  if (Array.isArray(message.content)) {
    const out: AssembledToolCall[] = [];
    for (const block of message.content) {
      if (block?.type === 'tool_use' && block?.name) {
        out.push({
          id: String(block.id || `call_${out.length}`),
          type: 'function',
          function: {
            name: String(block.name),
            arguments: JSON.stringify(block.input || {}),
          },
        });
      }
    }
    return out;
  }
  return [];
}
