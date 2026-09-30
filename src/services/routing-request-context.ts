/**
 * The person's Économique / Équilibré / Performance choice for the request in
 * flight.
 *
 * The composer has always sent it, and the generation pipeline reads it — but
 * the conversational paths (chat, plan, the closing recap) route through
 * `resolveAgentProviderModel`, which never saw it, so the control changed
 * nothing there. Held in AsyncLocalStorage, like the person's instructions,
 * the one place that picks a model reads it without every caller threading it.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { normalizeRoutingMode, type RoutingMode } from '../lib/routing-mode.ts';

const storage = new AsyncLocalStorage<{ mode: RoutingMode }>();

/** Runs `next` with the request's mode; a request that names none keeps the router's own default. */
export function runWithRoutingMode<T>(raw: unknown, next: () => T): T {
  if (typeof raw !== 'string' || !raw.trim()) return next();
  return storage.run({ mode: normalizeRoutingMode(raw.slice(0, 24)) }, next);
}

export function currentRoutingMode(): RoutingMode | undefined {
  return storage.getStore()?.mode;
}
