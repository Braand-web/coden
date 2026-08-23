import assert from 'node:assert/strict';
import { understandUserIntent } from './src/services/intent-understanding.ts';

type EvalCase = {
  prompt: string;
  hasFiles?: boolean;
  shouldMutate: boolean;
};

const cases: EvalCase[] = [
  { prompt: 'bonjour', shouldMutate: false },
  { prompt: 'que peux-tu faire ?', shouldMutate: false },
  { prompt: 'explique moi comment fonctionne le publish', hasFiles: true, shouldMutate: false },
  { prompt: 'reformule ce texte : cree une app restaurant moderne', shouldMutate: false },
  { prompt: 'ameliore ce prompt sans coder', shouldMutate: false },
  { prompt: 'analyse cette idee de marketplace avant de construire quoi que ce soit', hasFiles: true, shouldMutate: false },
  { prompt: 'donne moi une strategie SEO pour Coden', hasFiles: true, shouldMutate: false },
  { prompt: 'est-ce que je dois ajouter Google Auth ?', hasFiles: true, shouldMutate: false },
  { prompt: 'pourquoi mon bouton login ne marche pas ?', hasFiles: true, shouldMutate: false },
  { prompt: 'liste les risques si on modifie le billing', hasFiles: true, shouldMutate: false },
  { prompt: 'arrange ce texte pour mon client', shouldMutate: false },
  { prompt: 'compare Cursor et Codex', hasFiles: true, shouldMutate: false },
  { prompt: 'conseille-moi une palette pour un SaaS', hasFiles: true, shouldMutate: false },
  { prompt: 'fais un audit UX mais ne modifie rien', hasFiles: true, shouldMutate: false },
  { prompt: 'comment corriger une erreur redirect_uri_mismatch ?', hasFiles: true, shouldMutate: false },
  { prompt: 'critiques ce design systeme', hasFiles: true, shouldMutate: false },
  { prompt: 'dis-moi si tu comprends mon besoin', hasFiles: true, shouldMutate: false },
  { prompt: 'ecris un meilleur message de clarification', hasFiles: true, shouldMutate: false },
  { prompt: 'donne les etapes exactes pour Google OAuth', hasFiles: true, shouldMutate: false },
  { prompt: 'qu est ce qui manque pour etre au niveau de Lovable ?', hasFiles: true, shouldMutate: false },
  { prompt: 'cree une app todo list avec ajout modification suppression filtre recherche et responsive', shouldMutate: true },
  { prompt: 'crée une app todo list avec ajout modification suppression filtre recherche et responsive', shouldMutate: true },
  { prompt: 'genere une app restaurant avec menu reservation horaires avis et contact', shouldMutate: true },
  { prompt: 'génère une app restaurant avec menu reservation horaires avis et contact', shouldMutate: true },
  { prompt: 'ajoute Google Auth dans mon SaaS', hasFiles: true, shouldMutate: true },
  { prompt: 'corrige le bouton Publish qui ne fonctionne pas', hasFiles: true, shouldMutate: true },
  { prompt: 'change la couleur du CTA principal en bleu', hasFiles: true, shouldMutate: true },
  { prompt: 'supprime la page SEO et garde seulement la strategie meta sitemap robots', hasFiles: true, shouldMutate: true },
  { prompt: 'ajoute une section footer a la landing page', hasFiles: true, shouldMutate: true },
  { prompt: 'corrige la persistance des conversations apres refresh', hasFiles: true, shouldMutate: true },
  { prompt: 'implemente un endpoint GET /api/users/me/ai-usage', hasFiles: true, shouldMutate: true },
  { prompt: 'ajoute une confirmation avant suppression des taches', hasFiles: true, shouldMutate: true },
  { prompt: 'fais ca mieux', hasFiles: true, shouldMutate: true },
  { prompt: 'corrige', hasFiles: true, shouldMutate: false },
  { prompt: 'ajoute le truc comme avant', hasFiles: true, shouldMutate: false },
  { prompt: 'rends le plus premium', hasFiles: true, shouldMutate: false },
  { prompt: 'change ca', hasFiles: true, shouldMutate: true },
  { prompt: 'je veux la meme chose', hasFiles: true, shouldMutate: false },
  { prompt: 'peux-tu regarder pourquoi la preview est blanche et corriger le crash JS', hasFiles: true, shouldMutate: true },
  { prompt: 'remplace le loader preview par un loader circulaire creme bleu doux', hasFiles: true, shouldMutate: true },
  { prompt: 'ajoute un onglet AI Usage dans Settings', hasFiles: true, shouldMutate: true },
  { prompt: 'ne code pas encore, propose seulement un plan pour une app fintech', hasFiles: true, shouldMutate: false },
  { prompt: 'planifie puis attends ma validation', hasFiles: true, shouldMutate: false },
  { prompt: 'ecris le prompt systeme complet pour generer des UI Silicon Valley', hasFiles: true, shouldMutate: false },
  { prompt: 'est-ce que mon agent est comme toi ?', hasFiles: true, shouldMutate: false },
  { prompt: 'connecte Supabase database pour stocker les taches', hasFiles: true, shouldMutate: true },
  { prompt: 'ajoute un filtre completed active all dans la todo app existante', hasFiles: true, shouldMutate: true },
  { prompt: 'explique pourquoi tu as ajoute un provider non autorise', hasFiles: true, shouldMutate: false },
  { prompt: 'supprime tous les providers non whitelistes du backend et de l UI', hasFiles: true, shouldMutate: true },
  { prompt: 'donne moi un diagnostic de l erreur Request failed with 500', hasFiles: true, shouldMutate: false },
  { prompt: 'corrige les erreurs OpenRouter pour afficher un message propre', hasFiles: true, shouldMutate: true },
  { prompt: 'Coden stopped before saving because the generated app still has blocking issues', hasFiles: true, shouldMutate: true },
  { prompt: 'index.html should load /src/main.tsx as a module, corrige le probleme', hasFiles: true, shouldMutate: true },
  { prompt: "la preview ne s'affiche pas, repare la preview blanche", hasFiles: true, shouldMutate: true },
  { prompt: 'publie cette app maintenant', hasFiles: true, shouldMutate: true },
];

for (const item of cases) {
  const result = understandUserIntent({ prompt: item.prompt, hasFiles: item.hasFiles });
  assert.equal(result.allowsFileAction, item.shouldMutate, `${item.prompt} -> ${JSON.stringify(result)}`);
}

console.log('test-agent-intent-evals passed');
