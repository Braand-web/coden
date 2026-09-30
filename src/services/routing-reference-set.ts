/**
 * Thirty requests that stand for what people ask Coden to build.
 *
 * A routing change is judged on more than the request that motivated it. This
 * is the fixed set it is replayed against: three plans, every route, the
 * difficulty signals the pipeline really reads, requests with a mock-up
 * attached, and a project too large for a small context window. `replayRouting`
 * runs each through the same selector the pipeline uses and reports which
 * model each would go to and what that costs — a decision replay, no provider
 * call — so a change of weights, thresholds or positioning is compared on the
 * whole set before it touches a user. Whether the runs *succeed* is measured
 * on real traffic through the experiment arms (routing-experiments.ts).
 */
import { selectModel, liveBlendedCost, type SelectionResult, type TaskComplexity } from './model-selection.ts';
import { taskKindForRoute, type PipelineRoute } from './edit-intent.ts';
import type { RoutingMode } from './routing-policy.ts';

export type ReferenceRequest = {
  id: string;
  prompt: string;
  route: PipelineRoute;
  complexity: TaskComplexity;
  plan: 'free' | 'pro' | 'business';
  images?: boolean;
  contextTokens?: number;
};

const r = (id: string, plan: ReferenceRequest['plan'], route: PipelineRoute, complexity: TaskComplexity, prompt: string, extra: Partial<ReferenceRequest> = {}): ReferenceRequest => ({ id, plan, route, complexity, prompt, ...extra });

export const REFERENCE_SET: readonly ReferenceRequest[] = [
  r('todo-simple', 'free', 'new_project', 'medium', 'Crée une petite application de tâches avec des catégories.'),
  r('portfolio', 'free', 'new_project', 'medium', 'Un portfolio de photographe, sombre, avec galerie et page contact.'),
  r('vitrine-restaurant', 'free', 'new_project', 'medium', 'Site vitrine pour un restaurant : menu, réservation, horaires.'),
  r('landing-saas', 'pro', 'new_project', 'medium', 'Landing page d’un SaaS de facturation avec tarifs et FAQ.'),
  r('blog', 'free', 'new_project', 'medium', 'Un blog avec articles en Markdown et recherche.'),
  r('dashboard-analytics', 'pro', 'new_project', 'complex', 'Tableau de bord d’analytics avec graphiques, filtres et export CSV.'),
  r('saas-auth-billing', 'pro', 'new_project', 'complex', 'SaaS de gestion de projets avec authentification Supabase, équipes et abonnement Stripe.'),
  r('marketplace', 'business', 'new_project', 'extreme', 'Marketplace multi-vendeurs avec paiements, avis, messagerie et panneau d’administration, full stack en production.'),
  r('ecommerce', 'pro', 'new_project', 'complex', 'Boutique en ligne avec panier, paiement et gestion des commandes.'),
  r('crm', 'business', 'new_project', 'complex', 'Un CRM avec pipeline, contacts, rappels et rôles utilisateurs.'),
  r('game-2d', 'pro', 'new_project', 'complex', 'Un jeu de plateforme 2D en Canvas avec niveaux et score.'),
  r('game-3d', 'business', 'new_project', 'extreme', 'Un jeu 3D multijoueur en temps réel avec Three.js.'),
  r('realtime-chat', 'pro', 'new_project', 'complex', 'Une messagerie temps réel avec salons et présence.'),
  r('ai-tool', 'pro', 'new_project', 'complex', 'Un outil de résumé de documents avec IA et historique.'),
  r('admin-panel', 'business', 'new_project', 'complex', 'Un panneau d’administration avec tables, filtres et permissions.'),
  r('mockup-dashboard', 'pro', 'new_project', 'medium', 'Reproduis cette maquette de tableau de bord.', { images: true }),
  r('mockup-landing', 'free', 'new_project', 'medium', 'Fais une landing page fidèle à cette capture.', { images: true }),
  r('mockup-app-business', 'business', 'new_project', 'complex', 'Construis l’application mobile de cette maquette, avec la charte jointe.', { images: true }),
  r('edit-color', 'free', 'small_edit', 'simple', 'Change la couleur du bouton principal en vert.'),
  r('edit-title', 'free', 'small_edit', 'simple', 'Corrige la faute dans le titre de la page d’accueil.'),
  r('edit-add-field', 'pro', 'small_edit', 'medium', 'Ajoute un champ téléphone au formulaire de contact.'),
  r('edit-footer', 'pro', 'small_edit', 'simple', 'Ajoute un pied de page avec les réseaux sociaux.'),
  r('change-nav', 'pro', 'large_change', 'medium', 'Ajoute une barre latérale et déplace la navigation dedans.'),
  r('change-dark-mode', 'pro', 'large_change', 'medium', 'Ajoute un mode sombre sur toute l’application.'),
  r('change-auth', 'business', 'large_change', 'complex', 'Ajoute la connexion avec Google et des rôles admin / membre.'),
  r('change-refactor', 'business', 'large_change', 'complex', 'Refactorise l’état global et découpe les composants trop longs.'),
  r('change-i18n', 'pro', 'large_change', 'complex', 'Traduis toute l’application en anglais et en français avec un sélecteur.'),
  r('large-project-edit', 'business', 'large_change', 'complex', 'Ajoute un export PDF des factures.', { contextTokens: 240_000 }),
  r('huge-project-edit', 'business', 'large_change', 'complex', 'Migre l’ensemble des appels API vers le nouveau client.', { contextTokens: 620_000 }),
  r('fix-build', 'pro', 'small_edit', 'complex', 'Le build casse avec une erreur de type dans le panier, corrige-la.'),
];

export type ReplayDecision = { id: string; plan: string; route: PipelineRoute; modelId: string; usdPerMillion: number; ok: boolean; reason?: string; policy?: string };

export type ReplaySummary = {
  mode: RoutingMode;
  decisions: ReplayDecision[];
  resolved: number;
  unresolved: string[];
  modelShare: Array<{ model: string; share: number }>;
  meanUsdPerMillion: number;
  /** Decisions that differ from another replay of the same set, id → model. */
  maxDecisionMs: number;
};

/** Replays the set through the pipeline's own selector. Pure: no provider, no database. */
export function replayRouting(options: { mode?: RoutingMode; boost?: Record<string, number>; requests?: readonly ReferenceRequest[] } = {}): ReplaySummary {
  const mode = options.mode || 'balanced';
  const decisions: ReplayDecision[] = [];
  let maxDecisionMs = 0;
  for (const request of options.requests || REFERENCE_SET) {
    try {
      const result: SelectionResult = selectModel({
        task: taskKindForRoute(request.route),
        complexity: request.complexity,
        plan: request.plan,
        mode,
        boost: options.boost,
        interactive: true,
        estimatedInputTokens: request.contextTokens,
        needs: { tools: true, vision: Boolean(request.images), ...((request.contextTokens || 0) > 150_000 ? { longContext: true } : {}) },
      });
      maxDecisionMs = Math.max(maxDecisionMs, result.decisionMs || 0);
      decisions.push({ id: request.id, plan: request.plan, route: request.route, modelId: result.modelId, usdPerMillion: liveBlendedCost(result.modelId), ok: true, reason: result.reason, policy: result.policy });
    } catch (error: any) {
      decisions.push({ id: request.id, plan: request.plan, route: request.route, modelId: '', usdPerMillion: 0, ok: false, reason: String(error?.message || error) });
    }
  }
  const resolved = decisions.filter(decision => decision.ok);
  const counts = new Map<string, number>();
  for (const decision of resolved) counts.set(decision.modelId, (counts.get(decision.modelId) || 0) + 1);
  return {
    mode,
    decisions,
    resolved: resolved.length,
    unresolved: decisions.filter(decision => !decision.ok).map(decision => decision.id),
    modelShare: [...counts.entries()].map(([model, count]) => ({ model, share: Math.round((count / Math.max(1, resolved.length)) * 1000) / 1000 })).sort((a, b) => b.share - a.share),
    meanUsdPerMillion: resolved.length ? Math.round((resolved.reduce((sum, decision) => sum + decision.usdPerMillion, 0) / resolved.length) * 100) / 100 : 0,
    maxDecisionMs,
  };
}
