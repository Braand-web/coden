/**
 * The mode the composer offers, and nothing else.
 *
 * This is what survived `agent-run-contract.ts`: that module also carried the
 * run status machine, the plan and verification shapes and the stream-event
 * mapping, all of which existed only to drive the streaming run panel. The
 * mode is a property of the request the user is composing, so it outlives the
 * transport that used to report on it.
 */

export type AgentMode = 'auto' | 'build' | 'plan' | 'ask' | 'fix' | 'review' | 'research';

export function normalizeAgentMode(value: unknown): AgentMode {
  return value === 'build' || value === 'plan' || value === 'ask' || value === 'fix' || value === 'review' || value === 'research' ? value : 'auto';
}

export function modeLabel(mode: AgentMode, locale: 'fr' | 'en' = 'fr') {
  const labels = locale === 'fr'
    ? { auto: 'Auto', build: 'Construire', plan: 'Plan', ask: 'Demander', fix: 'Réparer', review: 'Revoir', research: 'Recherche' }
    : { auto: 'Auto', build: 'Build', plan: 'Plan', ask: 'Ask', fix: 'Fix', review: 'Review', research: 'Research' };
  return labels[mode];
}
