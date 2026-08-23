import { understandUserIntent, type IntentUnderstanding, type UserIntentCategory } from './intent-understanding.ts';

export type ExecutionContractMode =
  | 'chat'
  | 'clarify'
  | 'discuss_first'
  | 'plan'
  | 'build'
  | 'edit'
  | 'debug'
  | 'verify'
  | 'critical_action'
  | 'blocked';

export type ExecutionAction =
  | 'answer_only'
  | 'ask_one_question'
  | 'discuss_then_wait'
  | 'plan_only'
  | 'run_build'
  | 'run_edit'
  | 'run_debug_loop'
  | 'run_verification'
  | 'request_confirmation'
  | 'vent_to_user';

export type ExecutionContractTarget =
  | 'none'
  | 'app'
  | 'ui'
  | 'code'
  | 'bug'
  | 'backend'
  | 'publish'
  | 'media'
  | 'project';

export type ExecutionContract = {
  version: 'execution-contract/v1';
  mode: ExecutionContractMode;
  action: ExecutionAction;
  intent_category: UserIntentCategory;
  confidence: number;
  requested_mode: 'auto' | 'plan' | 'build';
  can_mutate_files: boolean;
  should_touch_preview: boolean;
  requires_runner: boolean;
  requires_confirmation: boolean;
  requires_clarification: boolean;
  uses_project_context: boolean;
  credit_policy: 'free' | 'metered' | 'build';
  quality_gate: 'none' | 'advisory' | 'blocking';
  target_kind: ExecutionContractTarget;
  target_files: string[];
  infrastructure: string[];
  risk: 'low' | 'medium' | 'high';
  lifecycle: string[];
  evidence_required: string[];
  prohibited_outputs: string[];
  model_workflow: {
    reasoning: boolean;
    structured_output: boolean;
    tool_calling: boolean;
    vision: boolean;
    long_context: boolean;
    streaming: boolean;
    role: string;
  };
  reason: string;
  user_visible_reason: string;
  clarification?: {
    question: string;
    choices: string[];
    recommendation: string;
  };
  legacy_intent?: string;
};

type LegacyDecision = {
  intent?: string;
  confidence?: number;
  requestedMode?: string;
  understandingCategory?: UserIntentCategory;
  intentUnderstanding?: Pick<IntentUnderstanding, 'category' | 'action' | 'confidence' | 'allowsFileAction' | 'needsClarification' | 'reason' | 'signals'>;
  requiresFileChanges?: boolean;
  requiresPreviewRebuild?: boolean;
  requiresCredits?: boolean;
  userVisibleReason?: string;
  reason?: string;
};

type ContractInput = {
  prompt: string;
  requestedMode?: string;
  hasFiles?: boolean;
  hasLastPlan?: boolean;
  legacyDecision?: LegacyDecision;
};

export function normalizeExecutionText(value: string) {
  return repairCommonEncodingBreaks(String(value || ''))
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function repairCommonEncodingBreaks(value: string) {
  return String(value || '')
    .replace(/cr\uFFFDer/gi, match => match[0] === 'C' ? 'Creer' : 'creer')
    .replace(/cr\uFFFDe/gi, match => match[0] === 'C' ? 'Cree' : 'cree')
    .replace(/g\uFFFDn\uFFFDrer/gi, match => match[0] === 'G' ? 'Generer' : 'generer')
    .replace(/g\uFFFDn\uFFFDr?e/gi, match => match[0] === 'G' ? 'Genere' : 'genere')
    .replace(/t\uFFFDches/gi, match => match[0] === 'T' ? 'Taches' : 'taches')
    .replace(/t\uFFFDche/gi, match => match[0] === 'T' ? 'Tache' : 'tache')
    .replace(/\uFFFDtats/gi, 'etats')
    .replace(/\uFFFDtat/gi, 'etat')
    .replace(/r\uFFFDponses/gi, 'reponses')
    .replace(/r\uFFFDponse/gi, 'reponse')
    .replace(/\uFFFD/g, 'e');
}

function includesAny(text: string, hints: string[]) {
  return hints.some(hint => text.includes(hint));
}

function clampConfidence(value: unknown, fallback = 0.82) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0.5, Math.min(0.99, numeric));
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function speaksFrench(prompt: string) {
  const text = normalizeExecutionText(prompt);
  return /\b(le|la|les|un|une|des|je|tu|vous|mon|ma|mes|dans|avec|pour|corrige|cree|genere|publie|ajoute|supprime)\b/i.test(text);
}

function isGreetingOrSimpleConversation(text: string) {
  const direct = new Set([
    'bonjour',
    'bonsoir',
    'salut',
    'coucou',
    'hello',
    'hi',
    'hey',
    'merci',
    'thanks',
    'thank you',
    'comment ca va',
    'comment tu vas',
    'how are you',
    'je veux juste discuter',
    'je veux discuter',
    'juste discuter',
    'parlons',
    'lets chat',
    'let s chat',
  ]);
  if (direct.has(text)) return true;
  return /^(bonjour|bonsoir|salut|hello|hi|hey)\b/i.test(text)
    || /\b(que peux tu faire|que peux-tu faire|what can you do|tu peux faire quoi)\b/i.test(text);
}

function isGeneralQuestion(text: string) {
  if (isExplicitAppBuildRequest(text) || isExplicitEditRequest(text) || isDebugFixRequest(text)) return false;
  return /\b(dis moi|dit moi|c est quoi|qu est ce que|qu est-ce que|explique|pourquoi|comment|conseil|avis|compare|resume|reformule|que penses tu|note mon|peux tu me dire|est ce que|what is|what are|why|how|should|can you explain|tell me about)\b/i.test(text);
}

function isDiscussFirst(text: string) {
  return includesAny(text, [
    'dis moi d abord',
    'dis-moi d abord',
    'explique d abord',
    'avant de coder',
    'avant de modifier',
    'avant de generer',
    'mais dis moi d abord',
    'mais dis-moi d abord',
    'demande moi avant',
    'confirme avant',
    'should i',
    'is it a good idea',
  ]);
}

function isBareAction(text: string) {
  return /^(cree|creer|create|build|make|genere|generer|generate|construis|fabrique|ajoute|modifie|corrige|ameliore|refais|implemente|applique|fais)(\s+(app|site|application|ca|tout|cela))?$/i.test(text.trim());
}

function isCriticalAction(text: string) {
  return /^(publie|publier|publish|deploie|deployer|deploy|rollback|restore|restaure|supprime le projet|delete project|reset database|supprime la base|apply migration|applique la migration|connecte domaine|custom domain|billing|stripe live|production)\b/i.test(text);
}

function isPlanOnlyRequest(text: string) {
  if (isExplicitAppBuildRequest(text) || isExplicitEditRequest(text) || isDebugFixRequest(text)) return false;
  return /\b(plan|roadmap|strategie|architecture|audit|analyse|compare|conseil|recommandation|prompt|design direction|direction creative|explique comment|que faut il|que faut-il)\b/i.test(text);
}

function isContinuationBuild(text: string, hasLastPlan: boolean) {
  if (!hasLastPlan) return false;
  return /\b(ok|oui|vas y|go|continue|applique|implemente|impl[ée]mente|fais le|build this plan|cree le|genere le)\b/i.test(text);
}

function isExplicitAppBuildRequest(text: string) {
  const hasAction = /\b(agis en tant que|je souhaite creer|je veux creer|j aimerais creer|i want to create|i need to build|cree|creer|create|build|make|genere|generer|generate|construis|fabrique|fais moi|realise|developpe)\b/i.test(text);

  // ✅ EXPANDED: explicit known targets
  const hasKnownTarget = /\b(app|application|mini application|mini app|site web|web app|landing page|dashboard|marketplace|crm|portfolio|ecommerce|e-commerce|restaurant|todo|to do|to-do|task|tache|taches|admin panel|saas|outil|tool|pomodoro|pomodero|timer|minuteur|quiz|game|jeu|calculatrice|calculator|calendar|calendrier|notes|blog|cms|forum|chat|messaging|booking|reservation|planning|scheduler|inventory|stock|gestion|management|tracker|monitor|analytics|reporting|directory|annuaire|listing|kanban|board|roadmap|project|sprint|survey|form builder|feedback|review|shop|store|boutique|catalog|catalogue|invoice|facturation|hr|rh|recruitment|cv|gallery|media|video|podcast|map|delivery|logistics|fleet|chatbot|assistant|generator|summarizer|translator|data viz|chart|leaderboard|tournament|schedule|event|community|network|social|feed|wallet|payment|billing|loyalty|reward|auction|rental|subscription|membership|ticketing|helpdesk|support|poll|vote|wiki|knowledge base|faq|comparator|configurator|wizard|onboarding|wishlist|employee|compliance|document|file manager|drive|backup|connector|plugin|widget|hub|portal|platform|exchange|trading|coupon|discount|promo|referral|affiliate)\b/i.test(text);

  // ✅ NEW: open-ended "une app de/pour [anything]" — zero assumptions about domain
  const hasGenericAppDesc = /\b(app|application|outil|tool|site|plateforme|platform|systeme|system|logiciel|software|interface|solution)\b[\s\S]{0,250}\b(de|pour|qui|avec|permettant|capable de|permettant de|dedié|dédiée|specialise|pour gerer|pour organiser|pour suivre|for|to manage|to track|to organize|that allows|that helps|to help)\b/i.test(text);

  const hasFeatureBundle = /\b(fonctionnalites indispensables|ajout|suppression|marquage|filtres|localstorage|stockage local|completed|active|termin[eé]es|taches|with add|with delete|with filters|with crud|avec crud)\b/i.test(text);

  return (hasAction && (hasKnownTarget || hasGenericAppDesc || hasFeatureBundle))
    || (hasKnownTarget && hasFeatureBundle)
    || /\b(todo|to do|to-do)\b[\s\S]{0,220}\b(ajout|add|suppression|delete|filtre|filter|localstorage|stockage local)\b/i.test(text);
}

function isExplicitEditRequest(text: string) {
  return /\b(ajoute|modifie|change|corrige|fix|debug|refais|ameliore|am[ée]liore|remplace|mets a jour|mets à jour|implemente|impl[ée]mente|applique)\b[\s\S]{0,140}\b(page|component|composant|api|database|base de donnees|interface|dashboard|builder|projet|code|bug|auth|login|supabase|vercel|button|bouton|couleur|texte|footer|header|pricing|settings|publish|fichier|file|ui|ux|agent)\b/i.test(text);
}

function isDebugFixRequest(text: string) {
  return /\b(debug|bug|erreur|error|crash|preview blanche|ecran blanc|blank preview|ne s affiche pas|n'affiche pas|ne fonctionne pas|failed|blocking issue|blocking issues|blocage restant|points bloquants|technical build score|index\.html should load|src\/main\.tsx|generated app still has|forced runtime failure marker|runtime failure marker|corrige le probleme|corrige ce probleme|corrige le blocage|corrige ce bug)\b/i.test(text);
}

function isVerifyRequest(text: string) {
  return /\b(verifie|v[ée]rifie|test|teste|audit|check|checks|preview|inspecte|smoke test)\b/i.test(text) && !isExplicitEditRequest(text) && !isExplicitAppBuildRequest(text);
}

function contractCategory(text: string, legacyDecision?: LegacyDecision): UserIntentCategory {
  if (legacyDecision?.intentUnderstanding?.category) return legacyDecision.intentUnderstanding.category;
  if (legacyDecision?.understandingCategory) return legacyDecision.understandingCategory;
  const local = understandUserIntent({ prompt: text });
  return local.category;
}

function targetKindFor(text: string, mode: ExecutionContractMode, category: UserIntentCategory): ExecutionContractTarget {
  if (mode === 'critical_action' && /\b(publish|publie|deploy|deploie|vercel|production)\b/i.test(text)) return 'publish';
  if (mode === 'debug') return 'bug';
  if (/\b(media|image|video|ugc|pub|ad|creative)\b/i.test(text)) return 'media';
  if (/\b(database|base de donnees|supabase|sql|rls|auth|stripe|api|backend)\b/i.test(text)) return 'backend';
  if (/\b(ui|ux|interface|design|button|bouton|header|footer|pricing|page|component|composant)\b/i.test(text)) return 'ui';
  if (category === 'code' || category === 'refactor') return 'code';
  if (mode === 'build' || /\b(app|application|mini app|site|outil|tool|dashboard|todo|saas|pomodoro|pomodero|timer|minuteur)\b/i.test(text)) return 'app';
  if (mode === 'edit') return 'project';
  return 'none';
}

function infrastructureFor(text: string) {
  const needs: string[] = [];
  if (/\b(supabase|postgres|sql|rls|policy|policies|database|base de donnees|crud|table)\b/i.test(text)) needs.push('supabase', 'database');
  if (/\b(auth|login|signup|oauth|google auth|session|role|permission)\b/i.test(text)) needs.push('auth');
  if (/\b(storage|upload|fichier|image|video|media|bucket)\b/i.test(text)) needs.push('storage');
  if (/\b(stripe|checkout|subscription|abonnement|payment|paiement|invoice|billing)\b/i.test(text)) needs.push('stripe');
  if (/\b(api|endpoint|edge function|webhook|server action)\b/i.test(text)) needs.push('api');
  if (/\b(publish|publie|deploy|deploie|vercel|production)\b/i.test(text)) needs.push('vercel');
  if (/\b(github|repo|repository|pull request|commit)\b/i.test(text)) needs.push('github');
  if (/\b(domain|domaine|dns|custom domain)\b/i.test(text)) needs.push('domain');
  return unique(needs);
}

function targetFilesFor(text: string, category: UserIntentCategory) {
  const files: string[] = [];
  if (/\b(app|application|todo|dashboard|landing|page|component|composant|ui|design|button|bouton|formulaire|form)\b/i.test(text)) {
    files.push('src/App.tsx', 'src/index.css');
  }
  if (/\b(vite|entrypoint|main tsx|index html|preview blanche|blank preview|ecran blanc)\b/i.test(text)) {
    files.push('index.html', 'src/main.tsx', 'src/App.tsx');
  }
  if (/\b(auth|login|signup|supabase|database|rls|schema|migration)\b/i.test(text)) {
    files.push('supabase/schema.sql', 'src/lib/supabase.ts', 'src/lib/validation.ts');
  }
  if (category === 'prompt' || category === 'strategy' || category === 'explanation') return [];
  return unique(files).slice(0, 8);
}

function modeAction(mode: ExecutionContractMode): ExecutionAction {
  if (mode === 'chat') return 'answer_only';
  if (mode === 'clarify') return 'ask_one_question';
  if (mode === 'discuss_first') return 'discuss_then_wait';
  if (mode === 'plan') return 'plan_only';
  if (mode === 'build') return 'run_build';
  if (mode === 'edit') return 'run_edit';
  if (mode === 'debug') return 'run_debug_loop';
  if (mode === 'verify') return 'run_verification';
  if (mode === 'critical_action') return 'request_confirmation';
  return 'vent_to_user';
}

function lifecycleFor(mode: ExecutionContractMode) {
  if (mode === 'chat') return ['intent_router', 'chat_response'];
  if (mode === 'clarify' || mode === 'discuss_first') return ['intent_router', 'user_confirmation'];
  if (mode === 'plan') return ['intent_router', 'knowledge_injection', 'planner'];
  if (mode === 'debug') return ['intent_router', 'knowledge_injection', 'sandbox', 'compile_and_test', 'auto_debug', 'visual_render'];
  if (mode === 'verify') return ['intent_router', 'sandbox', 'compile_and_test', 'visual_render'];
  if (mode === 'critical_action') return ['intent_router', 'user_confirmation'];
  if (mode === 'blocked') return ['intent_router', 'vent_to_user'];
  return ['intent_router', 'knowledge_injection', 'planner', 'sandbox', 'code_write', 'compile_and_test', 'auto_debug', 'visual_render'];
}

function reasonFor(mode: ExecutionContractMode, targetKind: ExecutionContractTarget) {
  if (mode === 'build') return `Clear build request for ${targetKind === 'none' ? 'an app' : targetKind}.`;
  if (mode === 'edit') return `Clear project modification request for ${targetKind}.`;
  if (mode === 'debug') return 'Debug signal detected from user message or failed preview/build language.';
  if (mode === 'clarify') return 'The message asks for action but does not name a concrete target.';
  if (mode === 'critical_action') return 'Sensitive platform action requires confirmation before execution.';
  if (mode === 'plan') return 'The user asked for analysis, strategy, audit, or planning without execution.';
  if (mode === 'discuss_first') return 'The user explicitly asked to discuss before coding.';
  if (mode === 'verify') return 'The user asked for verification without new code changes.';
  if (mode === 'blocked') return 'A prerequisite is missing before safe execution.';
  return 'Simple conversation or general question.';
}

function userReasonFor(mode: ExecutionContractMode, prompt: string) {
  const fr = speaksFrench(prompt);
  if (mode === 'build') return fr ? 'Coden va creer une vraie application et verifier la preview.' : 'Coden will create a real app and verify the preview.';
  if (mode === 'edit') return fr ? 'Coden va modifier le projet de facon ciblee.' : 'Coden will make a targeted project change.';
  if (mode === 'debug') return fr ? 'Coden va corriger le probleme, retester et garder une trace claire.' : 'Coden will fix the issue, retest, and keep a clear trace.';
  if (mode === 'clarify') return fr ? 'Il manque une cible concrete avant de modifier le projet.' : 'One concrete target is missing before changing the project.';
  if (mode === 'critical_action') return fr ? 'Cette action sensible demande confirmation.' : 'This sensitive action needs confirmation.';
  if (mode === 'plan') return fr ? 'Coden va repondre avec un plan sans modifier les fichiers.' : 'Coden will answer with a plan without changing files.';
  if (mode === 'discuss_first') return fr ? 'Coden va conseiller avant toute modification.' : 'Coden will advise before making any change.';
  if (mode === 'verify') return fr ? 'Coden va verifier sans modifier le projet.' : 'Coden will verify without changing the project.';
  if (mode === 'blocked') return fr ? 'Coden doit expliquer le blocage au lieu de forcer.' : 'Coden must explain the blocker instead of forcing the action.';
  return fr ? 'Coden repond simplement, sans projet ni preview.' : 'Coden will answer simply, without project or preview.';
}

function clarificationFor(mode: ExecutionContractMode, prompt: string): ExecutionContract['clarification'] | undefined {
  const fr = speaksFrench(prompt);
  if (mode === 'clarify') {
    return {
      question: fr ? 'Quelle app, ecran, composant ou bug dois-je traiter ?' : 'Which app, screen, component, or bug should I work on?',
      choices: [],
      recommendation: fr ? 'Exemple : "cree une todo app avec ajout, suppression, filtres et localStorage".' : 'Example: "create a todo app with add, delete, filters and localStorage".',
    };
  }
  if (mode === 'critical_action') {
    return {
      question: fr ? 'Confirme-tu cette action sensible avant que Coden continue ?' : 'Do you confirm this sensitive action before Coden continues?',
      choices: fr ? ['Confirmer', 'Annuler', 'Expliquer avant'] : ['Confirm', 'Cancel', 'Explain first'],
      recommendation: fr ? 'Confirme seulement si tu veux vraiment publier, restaurer, supprimer, modifier le domaine ou toucher au billing.' : 'Confirm only if you really want to publish, restore, delete, change domain, or touch billing.',
    };
  }
  return undefined;
}

function selectMode(input: ContractInput, text: string): ExecutionContractMode {
  const requestedMode = normalizeRequestedMode(input.requestedMode);
  const legacyIntent = input.legacyDecision?.intent || '';
  if (legacyIntent === 'external_keys_required' || legacyIntent === 'credits_required') return 'blocked';
  if (isCriticalAction(text)) return 'critical_action';
  if (requestedMode === 'plan') return 'plan';
  if (requestedMode === 'build' && !isBareAction(text)) {
    if (isDebugFixRequest(text)) return 'debug';
    return input.hasFiles ? 'edit' : 'build';
  }
  if (isContinuationBuild(text, Boolean(input.hasLastPlan))) return input.hasFiles ? 'edit' : 'build';
  if (isBareAction(text)) return 'clarify';
  if (isDiscussFirst(text)) return 'discuss_first';
  if (isGreetingOrSimpleConversation(text) || isGeneralQuestion(text)) return 'chat';
  if (isDebugFixRequest(text)) return 'debug';
  if (isExplicitAppBuildRequest(text)) return 'build';
  if (isExplicitEditRequest(text)) return input.hasFiles ? 'edit' : 'build';
  if (isVerifyRequest(text)) return 'verify';
  if (isPlanOnlyRequest(text)) return 'plan';
  if ((legacyIntent === 'build' || legacyIntent === 'edit' || legacyIntent === 'debug_fix') && (input.legacyDecision?.requiresFileChanges || input.legacyDecision?.requiresPreviewRebuild)) {
    if (legacyIntent === 'debug_fix') return 'debug';
    return legacyIntent === 'edit' ? 'edit' : 'build';
  }
  if (legacyIntent === 'plan') return 'plan';
  if (legacyIntent === 'clarification_required') return 'clarify';
  return 'chat';
}

function normalizeRequestedMode(value?: string): 'auto' | 'plan' | 'build' {
  if (value === 'plan' || value === 'build') return value;
  return 'auto';
}

export function buildExecutionContract(input: ContractInput): ExecutionContract {
  const text = normalizeExecutionText(input.prompt);
  const requestedMode = normalizeRequestedMode(input.requestedMode);
  const mode = selectMode(input, text);
  const category = contractCategory(text, input.legacyDecision);
  const targetKind = targetKindFor(text, mode, category);
  const canMutate = mode === 'build' || mode === 'edit' || mode === 'debug';
  const requiresRunner = canMutate || mode === 'verify';
  const confidence = mode === 'clarify'
    ? 0.74
    : clampConfidence(input.legacyDecision?.confidence, mode === 'build' || mode === 'debug' ? 0.91 : 0.84);
  const risk: ExecutionContract['risk'] = mode === 'critical_action' || targetKind === 'backend' ? 'high' : canMutate ? 'medium' : 'low';
  return {
    version: 'execution-contract/v1',
    mode,
    action: modeAction(mode),
    intent_category: category,
    confidence,
    requested_mode: requestedMode,
    can_mutate_files: canMutate,
    should_touch_preview: canMutate || mode === 'verify',
    requires_runner: requiresRunner,
    requires_confirmation: mode === 'critical_action',
    requires_clarification: mode === 'clarify',
    uses_project_context: canMutate || mode === 'verify' || input.hasFiles === true,
    credit_policy: canMutate ? 'build' : mode === 'plan' || mode === 'verify' ? 'metered' : 'free',
    quality_gate: canMutate ? 'blocking' : mode === 'plan' || mode === 'verify' ? 'advisory' : 'none',
    target_kind: targetKind,
    target_files: canMutate || mode === 'verify' ? targetFilesFor(text, category) : [],
    infrastructure: canMutate || mode === 'verify' ? infrastructureFor(text) : [],
    risk,
    lifecycle: lifecycleFor(mode),
    evidence_required: canMutate
      ? ['files_changed', 'preview_ready', 'runner_result']
      : mode === 'verify'
        ? ['runner_result']
        : [],
    prohibited_outputs: [
      'raw_json_plan_in_chat',
      'work_complete_before_execution',
      'preview_ready_without_preview_event',
      'files_updated_without_diff',
    ],
    model_workflow: {
      reasoning: mode !== 'chat',
      structured_output: mode === 'build' || mode === 'edit' || mode === 'debug' || mode === 'critical_action',
      tool_calling: canMutate || mode === 'verify',
      vision: /\b(image|screenshot|capture|figma|maquette|ui visuelle)\b/i.test(text),
      long_context: canMutate || mode === 'verify',
      streaming: false,
      role: mode === 'chat'
        ? 'fast_conversation'
        : mode === 'build'
          ? 'product_engineering_build'
          : mode === 'debug'
            ? 'debug_and_autofix'
            : 'intent_control',
    },
    reason: reasonFor(mode, targetKind),
    user_visible_reason: userReasonFor(mode, input.prompt),
    clarification: clarificationFor(mode, input.prompt),
    legacy_intent: input.legacyDecision?.intent,
  };
}

export function applyExecutionContractToDecision<T extends Record<string, any>>(decision: T, contract: ExecutionContract): T {
  const base = {
    ...decision,
    confidence: Math.max(clampConfidence(decision.confidence, 0.8), contract.confidence),
    requestedMode: contract.requested_mode,
    understandingCategory: contract.intent_category,
    requiresFileChanges: contract.can_mutate_files,
    requiresPreviewRebuild: contract.should_touch_preview,
    requiresCredits: contract.credit_policy !== 'free',
    userVisibleReason: contract.user_visible_reason,
    reason: contract.reason,
    executionContract: contract,
  };
  if (contract.mode === 'chat' || contract.mode === 'discuss_first') {
    return {
      ...base,
      intent: 'conversation',
      nextAction: 'answer',
      autoPlanRequired: false,
      selectedModelPolicy: 'economy',
      clarification: undefined,
    } as T;
  }
  if (contract.mode === 'clarify' || contract.mode === 'critical_action' || contract.mode === 'blocked') {
    const blockedIntent = contract.mode === 'blocked' && decision.intent === 'credits_required'
      ? 'credits_required'
      : 'external_keys_required';
    return {
      ...base,
      intent: contract.mode === 'blocked' ? blockedIntent : 'clarification_required',
      nextAction: contract.mode === 'blocked' && blockedIntent === 'credits_required'
        ? 'show_upgrade'
        : contract.mode === 'blocked'
          ? 'collect_external_keys'
          : 'ask_clarification',
      requiresFileChanges: false,
      requiresPreviewRebuild: false,
      requiresCredits: false,
      autoPlanRequired: false,
      selectedModelPolicy: 'economy',
      clarification: contract.clarification,
    } as T;
  }
  if (contract.mode === 'plan') {
    return {
      ...base,
      intent: 'plan',
      nextAction: 'plan_only',
      requiresFileChanges: false,
      requiresPreviewRebuild: false,
      selectedModelPolicy: 'balanced',
      autoPlanRequired: true,
      clarification: undefined,
    } as T;
  }
  if (contract.mode === 'debug') {
    return {
      ...base,
      intent: 'debug_fix',
      nextAction: 'debug_fix',
      selectedModelPolicy: 'premium',
      autoPlanRequired: false,
      clarification: undefined,
    } as T;
  }
  if (contract.mode === 'verify') {
    return {
      ...base,
      intent: 'verify',
      nextAction: 'verify',
      requiresFileChanges: false,
      selectedModelPolicy: 'balanced',
      autoPlanRequired: false,
      clarification: undefined,
    } as T;
  }
  return {
    ...base,
    intent: contract.mode === 'edit' ? 'edit' : 'build',
    nextAction: contract.mode === 'edit' ? 'edit' : 'build',
    selectedModelPolicy: contract.risk === 'high' ? 'premium' : 'balanced',
    autoPlanRequired: contract.risk === 'high',
    clarification: undefined,
  } as T;
}
