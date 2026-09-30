/**
 * Économique / Équilibré / Performance: the person's say in how Auto trades
 * price against capability. Client-safe (no server imports); the router reads
 * the same values through `services/routing-policy.ts`.
 */
export type RoutingMode = 'economy' | 'balanced' | 'performance';

export const ROUTING_MODES: readonly RoutingMode[] = ['economy', 'balanced', 'performance'];
export const ROUTING_MODE_LABELS: Record<RoutingMode, string> = { economy: 'Économique', balanced: 'Équilibré', performance: 'Performance' };
export const ROUTING_MODE_HINTS: Record<RoutingMode, string> = {
  economy: 'Économique : Auto privilégie les modèles les moins chers qui savent faire la tâche.',
  balanced: 'Équilibré : Auto cherche le meilleur rapport qualité / prix.',
  performance: 'Performance : Auto privilégie le modèle le plus capable, au prix de plus de crédits.',
};

/** An unknown or missing value is the middle mode, never an error. */
export function normalizeRoutingMode(value: unknown): RoutingMode {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'economy' || text === 'économique' || text === 'economique' || text === 'eco') return 'economy';
  if (text === 'performance' || text === 'perf' || text === 'quality') return 'performance';
  return 'balanced';
}

export const ROUTING_MODE_STORAGE_KEY = 'coden:routing-mode';

export function readRoutingMode(): RoutingMode {
  try { return normalizeRoutingMode(globalThis.localStorage?.getItem(ROUTING_MODE_STORAGE_KEY)); } catch { return 'balanced'; }
}

export function writeRoutingMode(mode: RoutingMode): void {
  try { globalThis.localStorage?.setItem(ROUTING_MODE_STORAGE_KEY, mode); } catch { /* storage may be blocked */ }
}
