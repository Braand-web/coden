/** Real, paid model evaluation. Never included in npm test. Prints labels/numbers only. */
import dotenv from 'dotenv';
import { resolveOpenRouterApiKey } from '../src/services/openrouter-service.ts';
import { OpenRouterDecisions, InternalRoutingBudget } from '../src/services/openrouter-decisions.ts';
import { INTENT_QUESTIONS, intentDecisionState, readIntentJudgement, judgementRejection,
  type DecisionRouterInput, type DecisionsIntent } from '../src/services/decisions-intent-router.ts';

dotenv.config({ quiet: true });
type Case = { name: string; input: DecisionRouterInput; expected: DecisionsIntent[]; mustFallback?: boolean };
const cases: Case[] = [
  { name: 'explain_publish', input: { prompt: 'Explique-moi comment fonctionne le bouton Publier.', hasFiles: true }, expected: ['conversation'] },
  { name: 'quoted_creation_request', input: { prompt: 'Reformule ce texte sans coder : "crée une application restaurant".', hasFiles: false }, expected: ['conversation'] },
  { name: 'create_small_app', input: { prompt: 'Crée une petite application de tâches avec ajout, suppression et filtre.', hasFiles: false }, expected: ['build'] },
  { name: 'edit_button', input: { prompt: 'Change la couleur du bouton principal en bleu.', hasFiles: true }, expected: ['edit'] },
  { name: 'repair_crash', input: { prompt: 'Corrige le crash JavaScript qui empêche l’aperçu de s’afficher.', hasFiles: true }, expected: ['debug_fix'] },
  { name: 'read_only_review', input: { prompt: 'Teste les formulaires et fais un audit UX sans modifier les fichiers.', hasFiles: true }, expected: ['verify'] },
  { name: 'plan_without_build', input: { prompt: 'Propose un plan pour intégrer les paiements, puis attends ma validation.', hasFiles: true }, expected: ['plan'] },
  { name: 'contextual_yes', input: { prompt: 'oui', hasFiles: true, recentHistory: [{ role: 'assistant', content: 'Veux-tu que j’ajoute un formulaire de réservation au restaurant ?' }] }, expected: ['edit', 'build'], mustFallback: true },
  { name: 'contextual_continue', input: { prompt: 'continue', hasFiles: false, lastPlan: 'Créer une application de suivi de dépenses avec ajout et suppression.', recentHistory: [{ role: 'assistant', content: 'Le plan est prêt. Veux-tu que je le réalise ?' }] }, expected: ['build'], mustFallback: true },
  { name: 'contextual_refusal', input: { prompt: 'non', hasFiles: true, recentHistory: [{ role: 'assistant', content: 'Veux-tu que je génère une image payante pour le hero ?' }] }, expected: ['conversation'], mustFallback: true },
];

async function main() {
  if (!process.argv.includes('--live')) {
    console.error('Use node --import tsx scripts/eval-decisions-intent.ts --live with the server OPENROUTER_API_KEY. Maximum provider spend including purchase fee: $0.10; no Coden customer credits.');
    process.exitCode = 2; return;
  }
  if (!resolveOpenRouterApiKey()) { console.error('DECISIONS_EVAL_NOT_CONFIGURED: server OpenRouter key unavailable. No paid request was sent.'); process.exitCode = 2; return; }
  const client = new OpenRouterDecisions({ apiKey: resolveOpenRouterApiKey });
  let cost = 0; let passed = 0; let badMutations = 0;
  const latencies: number[] = [];
  for (const test of cases) {
    try {
      // Ten independent cases, capped at one cent each, including purchase fee.
      const result = await client.decide(intentDecisionState(test.input), INTENT_QUESTIONS, new InternalRoutingBudget(), { maxCostUsd: 0.01 });
      const judgement = readIntentJudgement(result);
      const fallback = judgementRejection(judgement, test.input);
      const match = test.expected.includes(judgement.intent) && (!test.mustFallback || Boolean(fallback));
      if (match) passed += 1;
      if (['build', 'edit', 'debug_fix'].includes(judgement.intent) && !fallback && !test.expected.some(intent => ['build', 'edit', 'debug_fix'].includes(intent))) badMutations += 1;
      latencies.push(result.latencyMs);
      if (result.costUsd !== null) cost += result.costUsd * 1.055;
      console.log(JSON.stringify({ case: test.name, passed: match, intent: judgement.intent,
        confidence: judgement.confidence, fallback, latency_ms: result.latencyMs, cost_usd: result.costUsd }));
      if (result.costUsd === null) { console.error('DECISIONS_EVAL_UNKNOWN_COST: stopping instead of assuming zero cost.'); process.exitCode = 1; return; }
    } catch (error: any) {
      console.error(JSON.stringify({ case: test.name, passed: false, code: /^DECISIONS_[A-Z_0-9]+$/.test(error?.diagnosticCode || '') ? error.diagnosticCode : 'DECISIONS_EVAL_FAILED' }));
      process.exitCode = 1; return;
    }
  }
  latencies.sort((a, b) => a - b);
  console.log(JSON.stringify({ evaluation: 'coden-decisions-intent-v1', cases: cases.length, passed,
    unsafe_mutations: badMutations, provider_cost_with_fee_usd: Number(cost.toFixed(6)),
    p50_ms: latencies[Math.floor(latencies.length * 0.5)], p95_ms: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] }));
  if (passed !== cases.length || badMutations > 0) process.exitCode = 1;
}
void main().catch(() => { console.error('DECISIONS_EVAL_FAILED'); process.exitCode = 1; });
