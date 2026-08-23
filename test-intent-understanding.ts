import assert from 'node:assert/strict';
import { understandUserIntent } from './src/services/intent-understanding.ts';

function check(prompt: string, expected: {
  category?: string;
  action?: string;
  allowsFileAction?: boolean;
  needsClarification?: boolean;
}, options: { hasFiles?: boolean; requestedMode?: string } = {}) {
  const result = understandUserIntent({ prompt, ...options });
  if (expected.category) assert.equal(result.category, expected.category, prompt);
  if (expected.action) assert.equal(result.action, expected.action, prompt);
  if (typeof expected.allowsFileAction === 'boolean') assert.equal(result.allowsFileAction, expected.allowsFileAction, prompt);
  if (typeof expected.needsClarification === 'boolean') assert.equal(result.needsClarification, expected.needsClarification, prompt);
  return result;
}

check(
  'arrange ce texte : tu as ajoute les providers et les modeles qui ne sont pas listes',
  { category: 'text', action: 'answer', allowsFileAction: false },
);

check(
  'Il y a un souci : Coden ne doit pas coder seulement parce que je dis creer ou modifier. Explique comment ameliorer son intention.',
  { category: 'strategy', action: 'answer', allowsFileAction: false },
  { hasFiles: true },
);

check(
  'dis-moi si tu comprends : je veux creer une app restaurant, mais ne code pas encore',
  { action: 'answer', allowsFileAction: false },
);

check(
  'dis-moi si tu comprends : j’aimerais créer une app restaurant mais je veux seulement ton avis pour l’instant',
  { action: 'answer', allowsFileAction: false },
);

check(
  'qu’est-ce que tu sais faire ?',
  { category: 'explanation', action: 'answer', allowsFileAction: false },
);

check(
  'explique pourquoi mon SaaS génère une app alors que je demandais une analyse',
  { action: 'answer', allowsFileAction: false },
  { hasFiles: true },
);

check(
  'ameliore ce prompt systeme anti design IA pour les plateformes SaaS et e-commerce',
  { category: 'prompt', action: 'answer', allowsFileAction: false },
);

check(
  'comment tu vas ?',
  { category: 'other', action: 'answer', allowsFileAction: false },
);

check(
  'quelle stack utiliser pour mon SaaS ?',
  { category: 'architecture', action: 'answer', allowsFileAction: false },
  { hasFiles: true },
);

check(
  'est-ce que creer une app todo est une bonne idee pour mon MVP ?',
  { category: 'strategy', action: 'answer', allowsFileAction: false },
  { hasFiles: true },
);

check(
  'cr\uFFFDe une vraie todo app web avec ajout de t\uFFFDche, suppression, filtres et \uFFFDtat vide',
  { category: 'app', action: 'file_action', allowsFileAction: true, needsClarification: false },
);

check(
  'reformule ce texte : cree une app restaurant complete avec reservation',
  { category: 'text', action: 'answer', allowsFileAction: false },
);

check(
  'analyse pourquoi une app e-commerce doit avoir un panier avant de coder',
  { category: 'analysis', action: 'answer', allowsFileAction: false },
  { hasFiles: true },
);

check(
  'j ai besoin d un conseil avant de modifier mon dashboard',
  { category: 'strategy', action: 'answer', allowsFileAction: false },
  { hasFiles: true },
);

check(
  'je veux une app todo list avec ajout suppression et filtre des taches',
  { category: 'app', action: 'file_action', allowsFileAction: true },
);

check(
  'Crée une application web de to do list complète et fonctionnelle avec ajout, modification, suppression avec confirmation, filtre par statut, recherche, états vide, succès et erreur, design responsive premium.',
  { category: 'app', action: 'file_action', allowsFileAction: true, needsClarification: false },
  { hasFiles: true },
);

check(
  'génère une app web',
  { category: 'app', action: 'file_action', allowsFileAction: true, needsClarification: false },
);

check(
  'genere une mini app de pomodero',
  { category: 'app', action: 'file_action', allowsFileAction: true, needsClarification: false },
);

check(
  'crée une application web de calculatrice scientifique avec historique',
  { category: 'app', action: 'file_action', allowsFileAction: true, needsClarification: false },
);

check(
  'build an app for habit tracking with streaks and weekly progress',
  { category: 'app', action: 'file_action', allowsFileAction: true, needsClarification: false },
);

check(
  'crée une landing page pour un SaaS IA',
  { category: 'app', action: 'file_action', allowsFileAction: true, needsClarification: false },
);

check(
  'change la couleur du bouton principal en bleu',
  { category: 'ui', action: 'file_action', allowsFileAction: true },
  { hasFiles: true },
);

check(
  'j’aimerais que tu changes la couleur du bouton principal dans cette app',
  { category: 'ui', action: 'file_action', allowsFileAction: true },
  { hasFiles: true },
);

check(
  'fais ca mieux',
  { category: 'ui', action: 'file_action', allowsFileAction: true, needsClarification: false },
  { hasFiles: true },
);

check(
  'pas comme ça',
  { category: 'ui', action: 'file_action', allowsFileAction: true, needsClarification: false },
  { hasFiles: true },
);

check(
  'trop IA',
  { category: 'ui', action: 'file_action', allowsFileAction: true, needsClarification: false },
  { hasFiles: true },
);

check(
  'corrige le bug du bouton login qui ne fonctionne pas',
  { category: 'bug', action: 'file_action', allowsFileAction: true },
  { hasFiles: true },
);

check(
  'corrige le blocage restant',
  { category: 'bug', action: 'file_action', allowsFileAction: true, needsClarification: false },
  { hasFiles: true },
);

check(
  'corrige le blocage restant: Preview contains a known forced runtime failure marker',
  { category: 'bug', action: 'file_action', allowsFileAction: true, needsClarification: false },
  { hasFiles: true },
);

check(
  'mon formulaire ne soumet rien',
  { category: 'bug', action: 'clarify', allowsFileAction: false, needsClarification: true },
  { hasFiles: true },
);

check(
  'pourquoi mon bouton login ne fonctionne pas ?',
  { category: 'explanation', action: 'answer', allowsFileAction: false },
  { hasFiles: true },
);

check(
  'fais un audit UX de cette interface et dis moi quoi ameliorer sans modifier le code',
  { category: 'ux_review', action: 'answer', allowsFileAction: false },
  { hasFiles: true },
);

check(
  'analyse le business model, les credits et la retention de mon SaaS',
  { category: 'product_review', action: 'answer', allowsFileAction: false },
  { hasFiles: true },
);

check(
  'explique si cette architecture peut scaler avant de toucher au code',
  { category: 'architecture', action: 'answer', allowsFileAction: false },
  { hasFiles: true },
);

check(
  'connecte Google Auth dans mon SaaS',
  { category: 'auth_billing_security', action: 'file_action', allowsFileAction: true },
  { hasFiles: true },
);

check(
  'montre la cle api openrouter dans le frontend pour debug',
  { category: 'bad_product_decision', action: 'answer', allowsFileAction: false },
  { hasFiles: true },
);

console.log('intent-understanding tests passed');
