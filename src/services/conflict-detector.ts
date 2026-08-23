/**
 * Conflict Detector — detects contradicting consecutive requests.
 *
 * Solves: "Coden applique aveuglément la dernière demande sans avertir"
 *
 * Checks if the new prompt contradicts an established decision from
 * recent history and emits a warning + explanation when it does.
 */

export type ConflictType =
  | 'design_reversal'      // "rends plus grand" then "rends plus petit"
  | 'stack_contradiction'  // "utilise Vue" after "utilise React"
  | 'feature_removal'      // removing a feature just added
  | 'auth_contradiction'   // "sans auth" after "ajoute auth"
  | 'db_contradiction'     // "sans backend" after "avec Supabase"
  | 'color_reversal'       // "bleu" then "rouge"
  | 'layout_reversal'      // "sidebar" then "pas de sidebar"
  | 'none';

export type ConflictResult = {
  hasConflict: boolean;
  conflictType: ConflictType;
  previousSignal: string;
  newSignal: string;
  userVisibleWarning: string | null;
  autoResolution: 'apply_new' | 'ask_user' | 'merge';
};

type ConflictRule = {
  type: ConflictType;
  previousPattern: RegExp;
  contradictingPattern: RegExp;
  warningFr: string;
  warningEn: string;
  resolution: ConflictResult['autoResolution'];
};

const CONFLICT_RULES: ConflictRule[] = [
  // Size contradictions
  {
    type: 'design_reversal',
    previousPattern: /\b(plus grand|agrandis|bigger|larger|augmente la taille|increase size)\b/i,
    contradictingPattern: /\b(plus petit|reduis|smaller|shrink|diminue la taille|decrease size)\b/i,
    warningFr: "Tu viens de demander d'agrandir, puis de réduire. J'applique la dernière instruction (réduire).",
    warningEn: "You just asked to make it bigger, then smaller. Applying the latest instruction (smaller).",
    resolution: 'apply_new',
  },
  {
    type: 'design_reversal',
    previousPattern: /\b(plus petit|reduis|smaller|shrink)\b/i,
    contradictingPattern: /\b(plus grand|agrandis|bigger|larger)\b/i,
    warningFr: "Tu viens de demander de réduire, puis d'agrandir. J'applique la dernière instruction (agrandir).",
    warningEn: "You just asked to shrink it, then enlarge it. Applying the latest instruction (enlarge).",
    resolution: 'apply_new',
  },

  // Color contradictions
  {
    type: 'color_reversal',
    previousPattern: /\b(bleu|blue|#[0-9a-f]{3,6}|indigo|violet|purple)\b/i,
    contradictingPattern: /\b(rouge|red|orange|vert|green|rose|pink|jaune|yellow)\b.*\b(couleur|color|palette|theme)\b/i,
    warningFr: "La palette précédente était dans les tons bleus/froids. Tu demandes maintenant une autre couleur. J'applique le nouveau thème.",
    warningEn: "The previous palette was blue/cool tones. You're now requesting a different color. Applying the new theme.",
    resolution: 'apply_new',
  },

  // Stack contradictions
  {
    type: 'stack_contradiction',
    previousPattern: /\b(react|vite|nextjs|next\.js)\b/i,
    contradictingPattern: /\b(vue\.?js|angular|svelte|nuxt)\b/i,
    warningFr: "Le projet utilise React/Vite. Tu demandes maintenant un autre framework. Cela nécessiterait de recréer le projet depuis zéro.",
    warningEn: "The project uses React/Vite. You're now requesting a different framework. This would require rebuilding from scratch.",
    resolution: 'ask_user',
  },

  // Auth contradictions
  {
    type: 'auth_contradiction',
    previousPattern: /\b(ajoute|add|impl[eé]mente|connecte)\b.{0,40}\b(auth|login|authentification|connexion)\b/i,
    contradictingPattern: /\b(sans auth|no auth|retire l.auth|enleve l.auth|remove auth|pas d.auth)\b/i,
    warningFr: "Tu viens d'ajouter une authentification. Tu demandes maintenant de la retirer. Je peux le faire — confirme ou précise.",
    warningEn: "You just added authentication. You're now asking to remove it. I can do this — confirm or clarify.",
    resolution: 'ask_user',
  },

  // Database contradictions
  {
    type: 'db_contradiction',
    previousPattern: /\b(supabase|base de donn[eé]es|database|postgres|crud)\b/i,
    contradictingPattern: /\b(sans backend|no backend|sans base|local only|localStorage only|pas de base de donn[eé]es)\b/i,
    warningFr: "Le projet a déjà une base de données Supabase. Tu demandes maintenant de supprimer le backend. Je peux le faire — confirme.",
    warningEn: "The project already has a Supabase database. You're asking to remove the backend. I can do this — confirm.",
    resolution: 'ask_user',
  },

  // Layout contradictions
  {
    type: 'layout_reversal',
    previousPattern: /\b(sidebar|barre lat[eé]rale|navigation lat[eé]rale|side nav)\b/i,
    contradictingPattern: /\b(sans sidebar|no sidebar|enleve la sidebar|retire la sidebar|remove sidebar|topbar|barre du haut)\b/i,
    warningFr: "Le layout actuel a une sidebar. Tu demandes de la supprimer. J'applique le changement.",
    warningEn: "The current layout has a sidebar. You're asking to remove it. Applying the change.",
    resolution: 'apply_new',
  },

  // Feature removal of something just built
  {
    type: 'feature_removal',
    previousPattern: /\b(ajoute|add|impl[eé]mente|cree|create|build)\b.{0,60}\b(search|recherche|filtre|filter|tri|sort|pagination|modal|drawer)\b/i,
    contradictingPattern: /\b(supprime|remove|enleve|retire|delete)\b.{0,60}\b(search|recherche|filtre|filter|tri|sort|pagination|modal|drawer)\b/i,
    warningFr: "Tu viens d'ajouter cette fonctionnalité. Tu demandes maintenant de la supprimer. J'applique la suppression.",
    warningEn: "You just added this feature. You're now asking to remove it. Applying the removal.",
    resolution: 'apply_new',
  },
];

/**
 * Normalizes text for comparison — strips accents, lowercases, collapses spaces.
 */
function normalize(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isFrench(text: string): boolean {
  return /\b(je|tu|vous|nous|les|des|mon|ma|mes|dans|avec|pour|cree|genere|ajoute|supprime)\b/i.test(text);
}

/**
 * Detects conflicts between the new prompt and recent history.
 *
 * @param newPrompt - The current user prompt
 * @param recentHistory - Last 3-6 user messages (oldest first)
 * @param existingFiles - Current project files (to detect active features)
 */
export function detectPromptConflict(
  newPrompt: string,
  recentHistory: string[],
  existingFiles?: Array<{ path: string; content?: string }>,
): ConflictResult {
  const noConflict: ConflictResult = {
    hasConflict: false,
    conflictType: 'none',
    previousSignal: '',
    newSignal: '',
    userVisibleWarning: null,
    autoResolution: 'apply_new',
  };

  if (!newPrompt || recentHistory.length === 0) return noConflict;

  const newNorm = normalize(newPrompt);
  const fr = isFrench(newPrompt);

  // Check last 3 messages only — older context is less relevant
  const recentMessages = recentHistory.slice(-3);
  const combinedHistory = recentMessages.join(' ');
  const histNorm = normalize(combinedHistory);

  // Also check file content for active features
  const fileContent = (existingFiles || [])
    .slice(0, 10)
    .map(f => String(f.content || '').slice(0, 2000))
    .join('\n');

  for (const rule of CONFLICT_RULES) {
    // Check if history or files contain the "previous" pattern
    const prevMatch = rule.previousPattern.test(histNorm) || rule.previousPattern.test(fileContent);
    // Check if new prompt contains the "contradicting" pattern
    const newMatch = rule.contradictingPattern.test(newNorm);

    if (prevMatch && newMatch) {
      return {
        hasConflict: true,
        conflictType: rule.type,
        previousSignal: (histNorm.match(rule.previousPattern)?.[0] || '').slice(0, 50),
        newSignal: (newNorm.match(rule.contradictingPattern)?.[0] || '').slice(0, 50),
        userVisibleWarning: fr ? rule.warningFr : rule.warningEn,
        autoResolution: rule.resolution,
      };
    }
  }

  return noConflict;
}

/**
 * Formats a conflict warning for the agent system prompt.
 * Injected as a silent context note — the LLM decides whether to mention it.
 */
export function conflictToPromptContext(conflict: ConflictResult): string {
  if (!conflict.hasConflict) return '';
  return [
    `[CONFLICT_DETECTED type=${conflict.conflictType}]`,
    `Previous signal: "${conflict.previousSignal}"`,
    `New request contradicts: "${conflict.newSignal}"`,
    `Auto-resolution: ${conflict.autoResolution}`,
    conflict.autoResolution === 'apply_new'
      ? 'Apply the new request. Briefly mention what changed and why (1 sentence max).'
      : 'Before acting, ask the user one concise clarifying question about which direction to take. Do NOT make the change until confirmed.',
  ].join('\n');
}
