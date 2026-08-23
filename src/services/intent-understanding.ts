export type UserIntentCategory =
  | 'text'
  | 'explanation'
  | 'strategy'
  | 'analysis'
  | 'product_review'
  | 'ux_review'
  | 'design'
  | 'prompt'
  | 'bug'
  | 'code'
  | 'app'
  | 'api'
  | 'database'
  | 'auth_billing_security'
  | 'refactor'
  | 'architecture'
  | 'bad_product_decision'
  | 'ui'
  | 'other';

export type UserIntentAction = 'answer' | 'clarify' | 'file_action';

export type IntentUnderstanding = {
  category: UserIntentCategory;
  action: UserIntentAction;
  confidence: number;
  allowsFileAction: boolean;
  needsClarification: boolean;
  reason: string;
  signals: string[];
};

type IntentInput = {
  prompt: string;
  hasFiles?: boolean;
  requestedMode?: string;
  hasLastPlan?: boolean;
};

function normalizeIntentText(value: string) {
  return repairCommonEncodingBreaks(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`´ʼʹ']/g, ' ')
    .replace(/[!?.,;:()[\]{}"“”«»]/g, ' ')
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

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some(pattern => pattern.test(text));
}

function words(text: string) {
  return text.split(/\s+/).filter(Boolean);
}

function chooseFileActionCategory(input: {
  text: string;
  hasSensitiveTopic: boolean;
  hasRefactorIntent: boolean;
}): UserIntentCategory {
  const { text, hasSensitiveTopic, hasRefactorIntent } = input;
  if (hasSensitiveTopic) return 'auth_billing_security';
  if (hasRefactorIntent) return 'refactor';
  if (text.includes('api') || text.includes('endpoint')) return 'api';
  if (text.includes('database') || text.includes('base de donnees') || text.includes('supabase') || text.includes('schema')) return 'database';
  if (text.includes('bug') || text.includes('erreur') || text.includes('error') || text.includes('ne fonctionne pas')) return 'bug';
  if (text.includes('ui') || text.includes('bouton') || text.includes('button') || text.includes('design') || text.includes('component') || text.includes('composant')) return 'ui';
  return 'code';
}

function result(patch: Partial<IntentUnderstanding> & Pick<IntentUnderstanding, 'category' | 'action' | 'reason'>): IntentUnderstanding {
  const allowsFileAction = patch.action === 'file_action';
  return {
    confidence: 0.82,
    signals: [],
    ...patch,
    allowsFileAction: patch.allowsFileAction ?? allowsFileAction,
    needsClarification: patch.needsClarification ?? (patch.action === 'clarify'),
  };
}

export function understandUserIntent(input: IntentInput): IntentUnderstanding {
  const original = String(input.prompt || '').trim();
  const text = normalizeIntentText(original);
  const tokenCount = words(text).length;
  const requestedMode = input.requestedMode === 'build' ? 'build' : input.requestedMode === 'plan' ? 'plan' : 'auto';

  if (!text) {
    return result({
      category: 'other',
      action: 'clarify',
      confidence: 0.92,
      reason: 'empty_prompt',
      signals: ['empty'],
    });
  }

  const metaAgentSignals = [
    'coden', 'agent', 'quand il doit coder', 'quand coder', 'ne doit pas coder',
    'ne pas coder', 'ne rien generer', 'ne genere pas', 'ne doit jamais coder',
    'intention utilisateur', 'comprendre le message', 'comprehension', 'avant toute action',
    'ne comprend pas', 'ne comprend pas toujours', 'comprendre l intention',
    'au meme niveau que codex', 'lovable', 'cursor', 'chatgpt',
  ];
  const exampleSignals = [
    'par exemple', 'exemple', 'si je dis', 'supposons', 'imagine que',
    'il a genere', 'il ne fallait pas', 'alors que ce n etait pas necessaire',
  ];
  const textSignals = [
    'arrange ce texte', 'corrige ce texte', 'corrige les fautes', 'reformule',
    'reecris', 'reecrire', 'rewrite this', 'fix this text', 'improve this text',
    'resume ce texte', 'traduis', 'translate', 'mets en forme ce texte',
  ];
  const explanationSignals = [
    'explique', 'explique moi', 'dis moi', 'dis-moi', 'pourquoi', 'comment peut on',
    'comment peux tu', 'comment faire', 'donne moi les etapes', 'donne les etapes',
    'est ce que', 'est-ce que', 'que faut il', 'que faut-il', 'compare',
    'what is', 'how do', 'why', 'can you explain',
  ];
  const strategySignals = [
    'strategie', 'conseil', 'recommendation', 'recommandation', 'comment ameliorer',
    'que manque', 'que faut t il', 'que faut-il', 'au meme niveau', 'plan produit',
    'roadmap', 'analyse', 'audit', 'compare',
  ];
  const productReviewSignals = [
    'business model', 'modele economique', 'modèle économique', 'monetisation', 'monetization',
    'conversion', 'retention', 'mvp', 'pricing', 'tarifs', 'plans tarifaires', 'credits',
    'crédits', 'rentabilite', 'rentabilité', 'positionnement', 'go to market', 'gtm',
    'product market fit', 'pmf', 'priorite produit', 'priorité produit',
  ];
  const uxReviewSignals = [
    'audit ux', 'audit ui', 'ux review', 'ui review', 'analyse ux', 'analyse ui',
    'critique ux', 'critique ui', 'interface n est pas', 'design pas beau',
    'experience utilisateur', 'expérience utilisateur', 'parcours utilisateur',
    'wireframe', 'ergonomie', 'hiérarchie visuelle', 'hierarchie visuelle',
  ];
  const architectureReviewSignals = [
    'architecture', 'structure du projet', 'codebase', 'scalabilite', 'scalabilité',
    'dette technique', 'technical debt', 'stack', 'maintenabilite', 'maintenabilité',
    'refonte technique', 'refactor global', 'runner sandbox',
  ];
  const sensitiveSignals = [
    'auth', 'authentication', 'login', 'signup', 'billing', 'paiement', 'payment',
    'stripe', 'credits', 'crédits', 'wallet', 'admin', 'rls', 'role', 'permission',
    'permissions', 'api key', 'cle api', 'clé api', 'secret', 'service role',
    'openrouter', 'supabase', 'webhook', 'oauth', 'google auth',
  ];
  const badProductDecisionSignals = [
    'expose les couts fournisseur', 'expose les coûts fournisseur', 'affiche les marges',
    'affiche la marge', 'montre la cle api', 'montre la clé api', 'service role dans le front',
    'service_role dans le front', 'desactive rls', 'désactive rls', 'ignore rls',
    'tout le monde admin', 'rends tous les utilisateurs admin', 'supprime les credits',
    'supprime les crédits', 'bypass payment', 'contourne le paiement',
  ];
  const promptSignals = [
    'prompt systeme', 'system prompt', 'prompt system', 'ameliore ce prompt',
    'prompt puissant', 'anti design ia', 'direction artistique', 'design brief',
  ];
  const noActionSignals = [
    'ne code pas', 'sans coder', 'sans modifier', 'ne modifie rien', 'ne genere rien',
    'dis moi d abord', 'dis-moi d abord', 'explique d abord',
    'dis moi si tu comprends', 'dis-moi si tu comprends', 'est ce que tu comprends',
    'est-ce que tu comprends',
    'conseil avant', 'avant de modifier', 'avant de coder', 'avant de toucher',
    'avant de construire', 'avant de generer', 'avant d agir',
  ];
  const shortIterationFeedbackSignals = [
    'non', 'pas comme ca', 'pas comme ça', 'encore mieux', 'change', 'continue',
    'refais', 'trop simple', 'trop ia', 'pas premium', 'c est flou', 'cest flou',
    'tu n as pas compris', 'tu nas pas compris', 'pas ca', 'pas ça',
    'mieux', 'plus propre', 'plus pro', 'moins generique',
  ];

  const hasMetaAgent = includesAny(text, metaAgentSignals);
  const hasExample = includesAny(text, exampleSignals);
  const hasTextRequest = includesAny(text, textSignals);
  const hasExplanation = includesAny(text, explanationSignals);
  const hasStrategy = includesAny(text, strategySignals);
  const hasProductReview = includesAny(text, productReviewSignals);
  const hasUxReview = includesAny(text, uxReviewSignals);
  const hasArchitectureReview = includesAny(text, architectureReviewSignals);
  const hasSensitiveTopic = includesAny(text, sensitiveSignals);
  const hasBadProductDecision = includesAny(text, badProductDecisionSignals);
  const hasPromptRequest = includesAny(text, promptSignals);
  const hasNoAction = includesAny(text, noActionSignals);
  const hasShortIterationFeedback = Boolean(input.hasFiles)
    && tokenCount <= 8
    && includesAny(text, shortIterationFeedbackSignals);
  const hasAnalysisRequest = includesAny(text, [
    'analyse pourquoi', 'analyse comment', 'analyse si', 'analyse le', 'analyse la',
    'analyse les', 'fais une analyse', 'donne une analyse',
  ]);

  const directActionPatterns = [
    /\b(implemente|implementes|applique|appliques|corrige|corriges|corriger|fix|repare|repares|reparer|modifie|modifies|modifier|change|changes|changer|ajoute|ajoutes|ajouter|supprime|supprimes|supprimer|remplace|remplaces|remplacer|connecte|connectes|connecter|cree|crees|creer|genere|generes|generer|publie|publies|publier|deploie|deploies|deployer|build|update|fais|fait|mets|met|ameliore|ameliores|ameliorer)\b/,
    /\b(make|create|add|remove|replace|modify|implement|build|generate|repair|improve)\b/,
  ];
  const concreteTechnicalTargets = [
    'fichier', 'code', 'component', 'composant', 'page', 'api', 'endpoint', 'backend',
    'cette app', 'l app', 'l application', 'application actuelle', 'projet actuel',
    'frontend', 'database', 'base de donnees', 'supabase', 'schema', 'migration',
    'auth', 'login', 'bouton', 'button', 'input', 'modal', 'footer', 'header',
    'dashboard', 'builder', 'settings', 'pricing', 'preview', 'publish', 'deploy',
    'fonctionnalite', 'fonctionnalité', 'feature', 'workflow', 'formulaire', 'form',
    'navigation', 'filtre', 'filter', 'search', 'recherche', 'tableau', 'table',
    'todo', 'tache', 'taches', 'task', 'tasks', 'suppression', 'delete', 'remove',
    'confirmation', 'confirm', 'undo',
    'conversation', 'conversations', 'message', 'messages', 'reponse', 'reponses',
    'réponse', 'réponses', 'chat', 'streaming', 'feedback', 'retroaction', 'rétroaction',
    'pouce', 'pouces', 'thumb', 'thumbs', 'like', 'dislike',
    'persistance', 'persist', 'refresh', 'actualisation', 'session', 'localstorage',
    'cta', 'call to action', 'couleur', 'color', 'palette', 'theme',
    'texte', 'text', 'titre', 'title', 'typographie', 'font', 'taille', 'size',
    'radius', 'border', 'bordure', 'spacing', 'animation', 'loader',
    'css', 'html', 'react', 'vite', 'typescript', 'javascript', 'js',
  ];
  const appTargets = [
    'app', 'application', 'mini app', 'mini application', 'site web', 'web app', 'outil', 'tool',
    'landing page', 'saas', 'dashboard',
    'todo', 'restaurant', 'crm', 'marketplace', 'ecommerce', 'e commerce', 'portfolio',
    'admin panel', 'mobile app', 'pomodoro', 'pomodero', 'timer', 'minuteur', 'quiz', 'game',
    'jeu', 'calculatrice', 'calendar', 'calendrier', 'notes',
  ];

  const hasDirectAction = matchesAny(text, directActionPatterns);
  const hasTechnicalTarget = includesAny(text, concreteTechnicalTargets);
  const hasAppTarget = includesAny(text, appTargets);
  const hasRefactorIntent = includesAny(text, ['refactor', 'refactorise', 'refactoriser', 'refonte technique', 'restructure', 'restructurer']);
  const explicitArtifactPattern = matchesAny(text, [
    /\b(je veux|j aimerais|i want|i need|build me|cree moi|creer moi|genere moi|create a|create an|make me)\b/,
    /\b(cree|creer|genere|génère|build|create|make|construis|fabrique)\b.*\b(app|application|mini app|mini application|site web|web app|outil|tool|landing page|dashboard|marketplace|crm|portfolio|ecommerce|e commerce|admin panel)\b/,
    /\b(app|application|mini app|mini application|site web|web app|outil|tool|landing page|dashboard|marketplace|crm|portfolio|ecommerce|e commerce|admin panel)\b.*\b(complet|complete|fonctionnel|functional|responsive|avec|de|pour|qui)\b/,
  ]);
  const genericAppArtifactRequest = matchesAny(text, [
    /\b(cree|creer|genere|génère|build|create|make|construis|fabrique)\b[\s\S]{0,140}\b(app|application|mini app|mini application|site web|web app|outil|tool)\b/i,
    /\b(app|application|mini app|mini application|site web|web app|outil|tool)\b[\s\S]{0,140}\b(de|pour|avec|qui|fonctionnel|fonctionnelle|complete|complet)\b/i,
  ]);
  const explicitApplyToProduct = matchesAny(text, [
    /\b(implemente|applique|corrige|fix|repare|modifie|change|ajoute|supprime|remplace|connecte)\b.*\b(coden|saas|app|application|site|page|component|composant|api|database|supabase|ui|code|projet|agent|message|messages|reponse|reponses|réponse|réponses|feedback|retroaction|rétroaction|pouce|pouces)\b/,
    /\b(dans|sur)\b.*\b(coden|mon saas|mon app|mon application|le builder|dashboard|settings|pricing|auth|footer|api|database)\b/,
  ]);
  const chainedBuildAfterExplanation = matchesAny(text, [
    /\b(puis|ensuite|apres|après)\b.*\b(cree|creer|genere|generer|build|implemente|applique)\b/,
    /\b(cree|creer|genere|generer|build|implemente|applique)\b.*\b(puis|ensuite|apres|après)\b/,
  ]);
  const explanatoryOrMetaRequest =
    (hasExplanation || hasAnalysisRequest || hasMetaAgent || hasExample || hasStrategy)
    && !explicitApplyToProduct
    && requestedMode !== 'build'
    && !chainedBuildAfterExplanation;
  const isExistingProjectEditRequest =
    Boolean(input.hasFiles)
    && hasDirectAction
    && includesAny(text, ['cette app', 'dans cette app', 'l app', 'mon app', 'cette application', 'le projet', 'projet actuel'])
    && !matchesAny(text, [
      /\b(cree|creer|genere|generer|build|construis|fabrique)\b.*\b(app|application|site web|web app|landing page|dashboard|marketplace|crm|portfolio|ecommerce|e commerce|admin panel)\b/,
    ]);
  const asksForGeneratedArtifact =
    (explicitArtifactPattern || genericAppArtifactRequest)
    && (hasAppTarget || genericAppArtifactRequest)
    && !hasNoAction
    && !explanatoryOrMetaRequest
    && !isExistingProjectEditRequest;
  const hasBugReport = includesAny(text, [
    'ne fonctionne pas', 'ne marche pas', 'marche pas', 'bug', 'erreur',
    'error', 'request failed', 'crash', 'broken', 'cass', 'ne soumet rien',
    'soumet rien', 'n envoie rien', 'ne s ouvre pas', 'ne s affiche pas',
  ]) && hasTechnicalTarget && !asksForGeneratedArtifact;
  const hasGenerationFailureReport = Boolean(input.hasFiles) && includesAny(text, [
    'coden stopped before saving',
    'blocking issue',
    'blocking issues',
    'blocage restant',
    'corrige le blocage',
    'points bloquants',
    'technical build score',
    'preview ne s affiche pas',
    'app ne s affiche pas',
    'application ne s affiche pas',
    'generated app still has',
    'forced runtime failure marker',
    'runtime failure marker',
    'index html should load',
    'src main tsx',
    'main tsx absent',
    'app tsx absent',
    'corrige le probleme',
    'corrige ce probleme',
    'repare la preview',
    'preview blanche',
    'blank preview',
  ]) && !asksForGeneratedArtifact;
  const advisoryQuestionSignals = [
    'bonne idee', 'bon choix', 'mauvaise idee', 'dois je', 'devrais je',
    'est ce que je dois', 'est-ce que je dois', 'est ce une bonne idee', 'est-ce une bonne idee', 'est ce que c est une bonne idee',
    'should i', 'is it a good idea', 'avant de coder', 'avant de toucher',
    'conseil avant', 'pour mon mvp',
  ];
  const hasAdvisoryQuestion = hasExplanation && includesAny(text, advisoryQuestionSignals);

  if (hasBadProductDecision) {
    return result({
      category: 'bad_product_decision',
      action: 'answer',
      confidence: 0.95,
      reason: 'dangerous_or_product_harming_request',
      signals: ['bad_product_decision'],
    });
  }

  if (hasGenerationFailureReport && !hasNoAction) {
    return result({
      category: 'bug',
      action: 'file_action',
      confidence: 0.94,
      reason: 'generated_app_or_preview_failure_requires_debug_fix',
      signals: ['generation_failure', 'debug_fix'],
    });
  }

  if (hasNoAction && !explicitApplyToProduct) {
    return result({
      category: hasPromptRequest
        ? 'prompt'
        : hasUxReview
          ? 'ux_review'
          : hasProductReview
            ? 'product_review'
            : hasArchitectureReview
              ? 'architecture'
              : hasSensitiveTopic
                ? 'auth_billing_security'
                : hasAnalysisRequest
                  ? 'analysis'
                : hasStrategy
                  ? 'strategy'
                  : 'explanation',
      action: 'answer',
      confidence: 0.96,
      reason: 'user_explicitly_asked_no_file_changes',
      signals: ['no_action'],
    });
  }

  if ((hasTextRequest || hasPromptRequest) && !explicitApplyToProduct) {
    return result({
      category: hasTextRequest ? 'text' : 'prompt',
      action: 'answer',
      confidence: 0.95,
      reason: hasTextRequest ? 'text_rewrite_request' : 'prompt_or_design_prompt_request',
      signals: hasTextRequest ? ['text'] : ['prompt'],
    });
  }

  if ((hasMetaAgent || hasExample) && !explicitApplyToProduct && requestedMode !== 'build') {
    return result({
      category: hasMetaAgent ? 'strategy' : 'analysis',
      action: 'answer',
      confidence: 0.92,
      reason: hasMetaAgent ? 'meta_agent_or_product_strategy' : 'example_or_hypothetical_request',
      signals: [...(hasMetaAgent ? ['meta_agent'] : []), ...(hasExample ? ['example'] : [])],
    });
  }

  if (
    explanatoryOrMetaRequest
    && (hasExplanation || hasStrategy || hasAnalysisRequest)
    && !hasProductReview
    && !hasUxReview
    && !hasArchitectureReview
    && !hasSensitiveTopic
    && !hasBugReport
  ) {
    return result({
      category: hasAdvisoryQuestion || hasStrategy ? 'strategy' : hasAnalysisRequest ? 'analysis' : 'explanation',
      action: 'answer',
      confidence: 0.91,
      reason: hasAdvisoryQuestion || hasStrategy ? 'strategy_request_before_action' : hasAnalysisRequest ? 'analysis_request_before_action' : 'explanation_request_before_action',
      signals: hasAdvisoryQuestion || hasStrategy ? ['strategy'] : hasAnalysisRequest ? ['analysis'] : ['explanation'],
    });
  }

  if (hasAdvisoryQuestion && !explicitApplyToProduct && requestedMode !== 'build') {
    return result({
      category: hasAnalysisRequest ? 'analysis' : hasArchitectureReview ? 'architecture' : hasUxReview ? 'ux_review' : 'strategy',
      action: 'answer',
      confidence: 0.93,
      reason: 'advisory_question_not_generation_request',
      signals: ['advisory_question', ...(hasAnalysisRequest ? ['analysis'] : [])],
    });
  }

  if (hasAnalysisRequest && !explicitApplyToProduct && requestedMode !== 'build') {
    return result({
      category: hasUxReview
        ? 'ux_review'
        : hasProductReview
          ? 'product_review'
          : hasArchitectureReview
            ? 'architecture'
            : 'analysis',
      action: 'answer',
      confidence: 0.92,
      reason: 'analysis_request_not_file_action',
      signals: ['analysis'],
    });
  }

  if ((hasProductReview || hasUxReview || hasArchitectureReview || hasSensitiveTopic) && !explicitApplyToProduct && !asksForGeneratedArtifact && !hasDirectAction) {
    return result({
      category: hasUxReview
          ? 'ux_review'
          : hasArchitectureReview
            ? 'architecture'
            : hasProductReview
              ? 'product_review'
              : hasSensitiveTopic && !hasExplanation
                ? 'auth_billing_security'
                : 'explanation',
      action: 'answer',
      confidence: 0.9,
      reason: hasUxReview
          ? 'ux_review_without_code_request'
          : hasArchitectureReview
            ? 'architecture_review_without_code_request'
            : hasProductReview
              ? 'product_or_business_review_request'
              : hasSensitiveTopic && !hasExplanation
                ? 'sensitive_saas_topic_without_action_request'
                : 'explanation_request',
      signals: [
        ...(hasSensitiveTopic ? ['sensitive_topic'] : []),
        ...(hasUxReview ? ['ux_review'] : []),
        ...(hasArchitectureReview ? ['architecture_review'] : []),
        ...(hasProductReview ? ['product_review'] : []),
      ],
    });
  }

  if ((hasExplanation || hasStrategy) && !explicitApplyToProduct && !asksForGeneratedArtifact && !hasDirectAction) {
    return result({
      category: hasStrategy ? 'strategy' : 'explanation',
      action: 'answer',
      confidence: 0.9,
      reason: hasStrategy ? 'strategy_or_analysis_request' : 'explanation_request',
      signals: hasStrategy ? ['strategy'] : ['explanation'],
    });
  }

  if (hasBugReport && !hasNoAction && !hasDirectAction && requestedMode !== 'build') {
    return result({
      category: 'bug',
      action: 'clarify',
      confidence: 0.84,
      reason: 'implicit_bug_report_requires_scope_confirmation',
      signals: ['bug_report', 'technical_target', 'missing_direct_action'],
    });
  }

  if (hasBugReport && !hasNoAction) {
    return result({
      category: 'bug',
      action: 'file_action',
      confidence: 0.9,
      reason: 'concrete_bug_report_on_product_target',
      signals: ['bug_report', 'technical_target'],
    });
  }

  if (asksForGeneratedArtifact) {
    return result({
      category: 'app',
      action: 'file_action',
      confidence: 0.9,
      reason: 'explicit_app_generation_request',
      signals: ['app', 'direct_request', ...(tokenCount <= 7 ? ['defaults_allowed'] : [])],
    });
  }

  if (hasShortIterationFeedback && !hasNoAction) {
    return result({
      category: 'ui',
      action: 'file_action',
      confidence: 0.86,
      reason: 'short_feedback_iteration_on_existing_project',
      signals: ['short_feedback', 'iteration'],
    });
  }

  if (hasDirectAction && (hasTechnicalTarget || explicitApplyToProduct)) {
    const category = chooseFileActionCategory({ text, hasSensitiveTopic, hasRefactorIntent });
    return result({
      category,
      action: 'file_action',
      confidence: 0.9,
      reason: 'explicit_action_on_concrete_product_target',
      signals: ['direct_action', 'technical_target'],
    });
  }

  const ambiguousShortEdit = input.hasFiles
    && tokenCount <= 7
    && hasDirectAction
    && !hasTechnicalTarget
    && !hasAppTarget;
  if (ambiguousShortEdit) {
    return result({
      category: 'other',
      action: 'clarify',
      confidence: 0.82,
      reason: 'ambiguous_short_edit_without_target',
      signals: ['ambiguous'],
    });
  }

  if (requestedMode === 'build' && !hasTechnicalTarget && !hasAppTarget && !explicitApplyToProduct) {
    return result({
      category: 'other',
      action: 'clarify',
      confidence: 0.8,
      reason: 'build_mode_without_concrete_target',
      signals: ['build_mode', 'missing_target'],
    });
  }

  if (hasTechnicalTarget && !hasDirectAction) {
    return result({
      category: hasTechnicalTarget ? 'analysis' : 'other',
      action: 'answer',
      confidence: 0.76,
      reason: 'technical_topic_without_action_request',
      signals: ['technical_topic'],
    });
  }

  return result({
    category: 'other',
    action: 'answer',
    confidence: 0.72,
    reason: 'general_message_without_safe_file_action',
    signals: ['general'],
  });
}
