import assert from 'node:assert/strict';
import { understandUserIntent } from './src/services/intent-understanding.ts';

type ReadinessCase = {
  prompt: string;
  hasFiles?: boolean;
  expectedFileAction: boolean;
  label: string;
};

const readinessCases: ReadinessCase[] = [
  { label: 'greeting', prompt: 'bonjour', expectedFileAction: false },
  { label: 'capability_question', prompt: 'que sais-tu faire ?', expectedFileAction: false },
  { label: 'advice', prompt: 'comment améliorer mon SaaS pour atteindre 9.5/10 ?', hasFiles: true, expectedFileAction: false },
  { label: 'strategy', prompt: 'donne-moi une stratégie SEO puissante sans créer de page SEO', hasFiles: true, expectedFileAction: false },
  { label: 'explain_error', prompt: 'explique-moi pourquoi Google affiche redirect_uri_mismatch', hasFiles: true, expectedFileAction: false },
  { label: 'rephrase_text', prompt: 'arrange ce texte : crée une app restaurant moderne', expectedFileAction: false },
  { label: 'design_prompt', prompt: 'améliore ce prompt design Silicon Valley anti IA', hasFiles: true, expectedFileAction: false },
  { label: 'compare_agents', prompt: 'compare Coden à Codex et Cursor très sérieusement', hasFiles: true, expectedFileAction: false },
  { label: 'audit_without_change', prompt: 'fais un audit complet mais ne modifie rien', hasFiles: true, expectedFileAction: false },
  { label: 'ambiguous_do_better', prompt: 'rends le plus premium', hasFiles: true, expectedFileAction: false },
  { label: 'ambiguous_fix', prompt: 'corrige ça', hasFiles: true, expectedFileAction: false },
  { label: 'ambiguous_same', prompt: 'je veux la même chose', hasFiles: true, expectedFileAction: false },
  { label: 'build_todo', prompt: 'crée une app todo list complète avec ajout, édition, suppression, filtres et responsive', expectedFileAction: true },
  { label: 'build_restaurant', prompt: 'génère une app restaurant avec menu, réservation, horaires, avis et contact', expectedFileAction: true },
  { label: 'edit_ui', prompt: 'change la couleur du bouton Publish en bleu profond', hasFiles: true, expectedFileAction: true },
  { label: 'fix_bug', prompt: 'corrige le bouton Settings qui ne s’ouvre pas', hasFiles: true, expectedFileAction: true },
  { label: 'api_endpoint', prompt: 'ajoute GET /api/users/me/ai-usage', hasFiles: true, expectedFileAction: true },
  { label: 'database', prompt: 'connecte Supabase pour stocker les tâches', hasFiles: true, expectedFileAction: true },
  { label: 'auth', prompt: 'ajoute Google Auth dans mon SaaS', hasFiles: true, expectedFileAction: true },
  { label: 'publish', prompt: 'corrige la publication sous coden.fun/p/app-slug', hasFiles: true, expectedFileAction: true },
  { label: 'conversation_persistence', prompt: 'corrige la persistance des conversations après refresh', hasFiles: true, expectedFileAction: true },
  { label: 'streaming_ui', prompt: 'améliore le streaming IA visuel dans le flux de discussion', hasFiles: true, expectedFileAction: true },
  { label: 'feedback_ui', prompt: 'ajoute des pouces haut et bas sous les réponses de l’agent', hasFiles: true, expectedFileAction: true },
  { label: 'remove_page', prompt: 'supprime la page SEO mais garde la stratégie meta sitemap robots', hasFiles: true, expectedFileAction: true },
  { label: 'safe_plan_only', prompt: 'planifie une app fintech puis attends ma validation', hasFiles: true, expectedFileAction: false },
];

const results = readinessCases.map(item => {
  const result = understandUserIntent({ prompt: item.prompt, hasFiles: item.hasFiles });
  return {
    ...item,
    actualFileAction: result.allowsFileAction,
    action: result.action,
    category: result.category,
    reason: result.reason,
  };
});

const failures = results.filter(item => item.actualFileAction !== item.expectedFileAction);
const score = (results.length - failures.length) / results.length;

assert.ok(
  score >= 0.96,
  `Agent readiness score ${(score * 100).toFixed(1)}% below 96%.\n${failures.map(item => `${item.label}: expected ${item.expectedFileAction}, got ${item.actualFileAction} (${item.category}/${item.action}/${item.reason})`).join('\n')}`,
);

console.log(`agent readiness score ${(score * 100).toFixed(1)}% passed`);
