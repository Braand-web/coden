// Coden Decision Core — unified autonomous decision policy.
//
// Consolidates the scattered intent heuristics (intent-understanding,
// execution-contract, typed-intent-router, AgentOrchestrator branches) behind
// ONE typed decision: given the prompt + real project state, Coden decides on
// its own whether to talk, clarify, plan, build, edit, debug, confirm a
// critical action, or refuse — with a calibrated confidence and a traceable
// rationale that the conversation stream can render (MIX activity stream).
//
// Decision tree (evaluated in order — first match wins):
//   1. Explicit plan mode requested            → plan
//   2. Confirmation of a previous plan         → build (execute the plan)
//   3. Greeting / smalltalk / knowledge Q      → chat (free, no files touched)
//   4. Critical action (publish/delete/spend)  → critical_action (confirm first)
//   5. Unsafe / out-of-scope request           → refuse_redirect
//   6. Missing target (fix/edit with no files) → clarify (exactly one question)
//   7. Bug report on an existing project       → debug
//   8. High complexity or contradiction        → plan (then build on approval)
//   9. Targeted change on an existing project  → edit
//  10. New product / feature request           → build
//  11. Fallback                                → chat if confident, else clarify
//
// Confidence bands:
//   ≥ 0.8        act directly
//   0.5 – 0.8    act, but surface explicit assumptions to the user
//   < 0.5        clarify with one focused question

import { understandUserIntent, type IntentUnderstanding } from './intent-understanding.ts';

export type CodenDecisionAction =
  | 'chat'
  | 'clarify'
  | 'plan'
  | 'build'
  | 'edit'
  | 'debug'
  | 'critical_action'
  | 'refuse_redirect';

export type CodenConfidenceBand = 'act' | 'act_with_assumptions' | 'clarify';

export type CodenDecision = {
  version: 'decision-core/v1';
  action: CodenDecisionAction;
  confidence: number;
  band: CodenConfidenceBand;
  /** Why Coden chose this action — rendered in the agent activity stream. */
  rationale: string;
  /** Which tree node fired, for telemetry and eval replay. */
  decision_path: string;
  /** Assumptions surfaced to the user when acting at medium confidence. */
  assumptions: string[];
  /** Exactly one question when action === 'clarify'. */
  clarifying_question?: string;
  needs_confirmation: boolean;
  mutates_files: boolean;
  credit_policy: 'free' | 'metered' | 'build';
  complexity: number;
  signals: string[];
  intent: IntentUnderstanding;
};

export type DecisionProjectState = {
  hasFiles?: boolean;
  fileCount?: number;
  hasLastPlan?: boolean;
  lastBuildFailed?: boolean;
};

export type DecisionInput = {
  prompt: string;
  requestedMode?: 'auto' | 'plan' | 'build' | string;
  project?: DecisionProjectState;
  /** Set when conflict detection found a contradiction with recent decisions. */
  contradictsRecentDecision?: boolean;
};

function normalize(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´ʼ']/g, ' ')
    .replace(/[!?.,;:()[\]{}"“”«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const GREETING_RE = /^(salut|bonjour|bonsoir|coucou|hello|hi|hey|yo|merci|thanks|thank you|ca va|cava|comment ca va|good (morning|evening|afternoon))\b/;
const PLAN_CONFIRMATION_RE = /^(ok|okay|oui|yes|go|vas y|vas-y|c est bon|parfait|continue|continu|fais|fais le|fais-le|genere|execute|run|lance|build|ship it|let s go|lets go|allons y)$/;
const KNOWLEDGE_QUESTION_RE = /\b(c est quoi|qu est ce que|what is|what are|comment fonctionne|how does|explique|explain|difference entre|difference between|pourquoi|why is)\b/;
const CRITICAL_ACTION_RE = /\b(publie|publier|publish|deploie|deployer|deploy|mets? en (prod|production)|production|supprime (le|ce|mon) projet|delete (the|this|my) project|reset(te)? (tout|la base|everything)|drop (la |the )?(base|database)|facture|paiement reel|achete|buy|depense|spend)\b/;
const UNSAFE_RE = /\b(malware|ransomware|keylogger|ddos|phishing|carte de credit volee|stolen credit card|pirater|hack(er)? (un|le|a|the)\b|spyware|exploit zero.?day|contourner (la |les )?(securite|protections))\b/;
const BUG_RE = /\b(bug|erreur|error|crash|plante|plantage|casse|broken|ne (fonctionne|marche) (pas|plus)|doesn t work|not working|fails?|echoue|exception|undefined is not|nan\b|blank (page|screen)|page blanche)\b/;
const EDIT_RE = /\b(modifie|modifier|change|changer|ajoute|ajouter|add|remplace|replace|renomme|rename|deplace|move|supprime (le |la |ce |cette )?(bouton|button|section|page|champ|field|image|texte|text)|update|met[s]? a jour|ameliore|improve|corrige le (style|design|css)|agrandis|reduis|redimensionne)\b/;
const BUILD_RE = /\b(cree|creer|construis|construire|genere|generer|fais (moi|une|un)|build|create|make (me|a|an)|nouvelle? (app|application|site|outil|dashboard)|new (app|site|tool|dashboard)|landing page|saas|marketplace|crm|e-?commerce|boutique|blog)\b/;
const VAGUE_TARGET_RE = /^(corrige|fix|repare|repair|debug|ameliore|improve|change|modifie|update)( (ca|cela|le|la|tout|it|this|that))?$/;

const COMPLEXITY_HINTS: { re: RegExp; weight: number; label: string }[] = [
  { re: /\b(auth|login|signup|inscription|connexion)\b/, weight: 0.15, label: 'auth' },
  { re: /\b(paiement|payment|stripe|checkout|abonnement|subscription|billing)\b/, weight: 0.2, label: 'payments' },
  { re: /\b(base de donnees|database|supabase|sql|persist|sauvegarde)\b/, weight: 0.15, label: 'database' },
  { re: /\b(temps reel|realtime|websocket|live)\b/, weight: 0.15, label: 'realtime' },
  { re: /\b(upload|fichier|file|storage|image|video)\b/, weight: 0.1, label: 'storage' },
  { re: /\b(admin|role|permission|multi.?tenant|organisation|equipe|team)\b/, weight: 0.15, label: 'roles' },
  { re: /\b(api|integration|webhook|externe|external)\b/, weight: 0.1, label: 'integrations' },
  { re: /\b(ia|ai|llm|chatbot|agent|generation)\b/, weight: 0.1, label: 'ai' },
];

export function scoreComplexity(prompt: string): { score: number; signals: string[] } {
  const text = normalize(prompt);
  const tokens = text.split(/\s+/).filter(Boolean).length;
  const signals: string[] = [];
  let score = 0;
  for (const hint of COMPLEXITY_HINTS) {
    if (hint.re.test(text)) {
      score += hint.weight;
      signals.push(hint.label);
    }
  }
  if (tokens > 60) { score += 0.15; signals.push('long_request'); }
  else if (tokens > 30) { score += 0.08; signals.push('detailed_request'); }
  const featureCount = (text.match(/\b(et|and|avec|with|plus|aussi|also)\b/g) || []).length;
  if (featureCount >= 4) { score += 0.12; signals.push('many_features'); }
  return { score: Math.min(1, score), signals };
}

export function confidenceBand(confidence: number): CodenConfidenceBand {
  if (confidence >= 0.8) return 'act';
  if (confidence >= 0.5) return 'act_with_assumptions';
  return 'clarify';
}

function creditPolicyFor(action: CodenDecisionAction): CodenDecision['credit_policy'] {
  if (action === 'build' || action === 'debug') return 'build';
  if (action === 'edit' || action === 'plan') return 'metered';
  return 'free';
}

function mutatesFiles(action: CodenDecisionAction): boolean {
  return action === 'build' || action === 'edit' || action === 'debug';
}

type Draft = {
  action: CodenDecisionAction;
  confidence: number;
  rationale: string;
  decision_path: string;
  assumptions?: string[];
  clarifying_question?: string;
  needs_confirmation?: boolean;
};

export function decideCodenAction(input: DecisionInput): CodenDecision {
  const prompt = String(input.prompt || '').trim();
  const text = normalize(prompt);
  const project = input.project || {};
  const hasFiles = Boolean(project.hasFiles || (project.fileCount || 0) > 0);
  const requestedMode = input.requestedMode === 'plan' ? 'plan' : input.requestedMode === 'build' ? 'build' : 'auto';
  const intent = understandUserIntent({
    prompt,
    hasFiles,
    requestedMode,
    hasLastPlan: Boolean(project.hasLastPlan),
  });
  const complexity = scoreComplexity(prompt);

  const finish = (draft: Draft): CodenDecision => {
    const band = draft.action === 'clarify' ? 'clarify' : confidenceBand(draft.confidence);
    return {
      version: 'decision-core/v1',
      action: draft.action,
      confidence: Math.max(0, Math.min(1, draft.confidence)),
      band,
      rationale: draft.rationale,
      decision_path: draft.decision_path,
      assumptions: band === 'act_with_assumptions' ? (draft.assumptions || []) : [],
      clarifying_question: draft.clarifying_question,
      needs_confirmation: Boolean(draft.needs_confirmation),
      mutates_files: mutatesFiles(draft.action),
      credit_policy: creditPolicyFor(draft.action),
      complexity: complexity.score,
      signals: [...complexity.signals, ...intent.signals],
      intent,
    };
  };

  // 1. Explicit plan mode.
  if (requestedMode === 'plan') {
    return finish({
      action: 'plan',
      confidence: 1,
      rationale: 'Plan mode was explicitly requested, so Coden prepares a plan without touching files.',
      decision_path: 'explicit_plan_mode',
    });
  }

  // 2. Confirmation of a previous plan.
  if (project.hasLastPlan && PLAN_CONFIRMATION_RE.test(text)) {
    return finish({
      action: 'build',
      confidence: 0.95,
      rationale: 'The user confirmed the previous plan, so Coden executes it instead of asking again.',
      decision_path: 'plan_confirmation',
    });
  }

  // Empty or near-empty prompt.
  if (!text || text.length < 3) {
    return finish({
      action: 'clarify',
      confidence: 0.3,
      rationale: 'The message is too short to infer a goal.',
      decision_path: 'empty_prompt',
      clarifying_question: 'Que veux-tu construire ou modifier ?',
    });
  }

  // 3. Greeting / smalltalk / pure knowledge question.
  if (GREETING_RE.test(text) && text.split(' ').length <= 6) {
    return finish({
      action: 'chat',
      confidence: 0.95,
      rationale: 'This is a greeting, so Coden answers without touching files or spending credits.',
      decision_path: 'greeting',
    });
  }
  if (KNOWLEDGE_QUESTION_RE.test(text) && !BUILD_RE.test(text) && !EDIT_RE.test(text) && !BUG_RE.test(text)) {
    return finish({
      action: 'chat',
      confidence: 0.85,
      rationale: 'This is a knowledge question, so Coden answers conversationally.',
      decision_path: 'knowledge_question',
    });
  }

  // 4. Critical action — never auto-execute.
  if (CRITICAL_ACTION_RE.test(text)) {
    return finish({
      action: 'critical_action',
      confidence: 0.9,
      rationale: 'This action is hard to reverse (publish/production/delete/spend), so Coden asks for explicit confirmation first.',
      decision_path: 'critical_action',
      needs_confirmation: true,
    });
  }

  // 5. Unsafe / out-of-scope.
  if (UNSAFE_RE.test(text)) {
    return finish({
      action: 'refuse_redirect',
      confidence: 0.95,
      rationale: 'The request is unsafe or out of scope for Coden, so it declines and redirects.',
      decision_path: 'unsafe_request',
    });
  }

  // 6. Missing target — fix/edit verbs with nothing to act on.
  if (!hasFiles && (VAGUE_TARGET_RE.test(text) || ((BUG_RE.test(text) || EDIT_RE.test(text)) && !BUILD_RE.test(text)))) {
    return finish({
      action: 'clarify',
      confidence: 0.4,
      rationale: 'The user asks for a change but there is no project yet, so Coden asks one focused question.',
      decision_path: 'missing_target',
      clarifying_question: 'Il n’y a pas encore de projet ici — veux-tu que je crée une nouvelle app, ou parles-tu d’un autre projet ?',
    });
  }
  if (hasFiles && VAGUE_TARGET_RE.test(text)) {
    return finish({
      action: 'clarify',
      confidence: 0.45,
      rationale: 'The change request has no identifiable target, so Coden asks one focused question instead of guessing.',
      decision_path: 'vague_target',
      clarifying_question: 'Que dois-je corriger ou améliorer exactement (page, composant, comportement) ?',
    });
  }

  // 7. Bug on an existing project.
  if (hasFiles && (BUG_RE.test(text) || intent.category === 'bug' || project.lastBuildFailed)) {
    return finish({
      action: 'debug',
      confidence: project.lastBuildFailed ? 0.9 : 0.85,
      rationale: project.lastBuildFailed
        ? 'The last build failed, so Coden runs the debug loop on the reported issue.'
        : 'The user reports broken behavior on an existing project, so Coden investigates and fixes it.',
      decision_path: 'debug_existing',
    });
  }

  // 8. High complexity or contradiction → plan first.
  if (input.contradictsRecentDecision) {
    return finish({
      action: 'plan',
      confidence: 0.75,
      rationale: 'This request contradicts a recent decision, so Coden proposes a plan before changing files.',
      decision_path: 'contradiction_plan',
      assumptions: ['Le nouveau besoin remplace la décision précédente.'],
    });
  }
  if (complexity.score >= 0.5 && BUILD_RE.test(text) && !hasFiles) {
    return finish({
      action: 'plan',
      confidence: 0.8,
      rationale: `This is a complex product (${complexity.signals.join(', ')}), so Coden plans the architecture before building.`,
      decision_path: 'complex_build_plan',
    });
  }

  // 9. Targeted change on an existing project.
  if (hasFiles && (EDIT_RE.test(text) || intent.category === 'ui' || intent.category === 'code')) {
    return finish({
      action: 'edit',
      confidence: 0.85,
      rationale: 'The user asks for a targeted change on the existing project, so Coden edits only what is needed.',
      decision_path: 'targeted_edit',
    });
  }

  // 10. New product / feature build.
  if (BUILD_RE.test(text) || requestedMode === 'build' || intent.category === 'app') {
    const medium = complexity.score >= 0.25;
    return finish({
      action: 'build',
      confidence: medium ? 0.75 : 0.85,
      rationale: 'The user asks for a new product or feature, so Coden generates it.',
      decision_path: 'new_build',
      assumptions: medium
        ? ['Stack par défaut : React + Vite + Supabase (Coden Cloud).', 'Périmètre : MVP fonctionnel des features demandées.']
        : [],
    });
  }

  // 11. Fallback: answer if the intent layer is confident it's conversational.
  if (intent.action === 'answer' && intent.confidence >= 0.5) {
    return finish({
      action: 'chat',
      confidence: intent.confidence,
      rationale: 'The request reads as conversational, so Coden answers directly.',
      decision_path: 'fallback_chat',
      assumptions: intent.confidence < 0.8 ? ['La demande ne nécessite pas de modification de fichiers.'] : [],
    });
  }
  return finish({
    action: 'clarify',
    confidence: Math.min(intent.confidence, 0.45),
    rationale: 'Coden is not confident about the goal, so it asks one focused question instead of guessing.',
    decision_path: 'fallback_clarify',
    clarifying_question: 'Peux-tu préciser : veux-tu une réponse, une nouvelle app, ou une modification du projet actuel ?',
  });
}

/** Compact line for the agent activity stream header (MIX UI). */
export function describeDecisionForStream(decision: CodenDecision): string {
  const labels: Record<CodenDecisionAction, string> = {
    chat: 'Répondre',
    clarify: 'Clarifier',
    plan: 'Planifier',
    build: 'Coder',
    edit: 'Modifier',
    debug: 'Déboguer',
    critical_action: 'Confirmer avant d’agir',
    refuse_redirect: 'Décliner',
  };
  return `Décision : ${labels[decision.action]} · ${decision.rationale}`;
}
