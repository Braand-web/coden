/**
 * @deprecated Legacy entry point kept for backward compatibility.
 * The streaming implementation moved to `src/lib/stream-client.ts`
 * (Coden Stream v2: typed protocol, reconnection with Last-Event-ID,
 * AbortController cancellation, smooth text rendering).
 * New code must import from `./stream-client` instead.
 */
export { createJsonSseParser } from './stream-client.ts';
export type { JsonSseEventHandler } from './stream-client.ts';
