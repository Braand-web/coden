/** SSE framing is independent of network chunk boundaries and UTF-8 bytes. */
export async function* readProviderSse(
  chunks: AsyncIterable<Uint8Array>,
  onChunk?: () => void,
): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  for await (const chunk of chunks) {
    onChunk?.();
    buffer += decoder.decode(chunk, { stream: true });
    // Bound one incomplete frame, not the whole response.
    if (buffer.length > 8_000_000) throw new Error('PROVIDER_STREAM_FRAME_TOO_LARGE');
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const lines = frame.split(/\r?\n/).filter(line => line.startsWith('data:'));
      if (lines.length) yield lines.map(line => line.slice(5).replace(/^ /, '')).join('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim() && !buffer.trim().startsWith(':')) throw new Error('PROVIDER_STREAM_TRUNCATED');
}
