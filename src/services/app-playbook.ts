/**
 * What people expect of this kind of product, handed to the coder before it writes.
 *
 * The production blueprints describe twenty kinds of app — the screens, the flows,
 * the states, the risks, what "done" means — but the live pipeline only read them
 * for a label. A request for a booking app reached the coder as a sentence, and
 * the coder invented the shape of a booking app each time; the availability
 * calendar, the confirmation step, the empty « aucune réservation » screen came
 * and went from one run to the next.
 *
 * This turns the matching blueprint into a short brief. It is a checklist of what
 * this kind of product usually needs, not a widening of the request: the person's
 * own words always win, and a kind of app is only recognised on a clear signal —
 * a bare word like « prompt » or « note » in a sentence is not one.
 *
 * Small tools — a calculator, a converter, a timer — get no brief: they are finished when they work, and a
 * checklist of screens and states only makes them grow.
 *
 * Off unless `CODEN_APP_PLAYBOOK=1`: it has not been measured on live generations yet.
 */
import { inferProductionBlueprint, type ProductionBlueprint, type ProductionBlueprintType } from './production-blueprints.ts';

export function appPlaybookEnabled(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): boolean {
  return env.CODEN_APP_PLAYBOOK === '1';
}

/** A clear signal for each kind: without one of these the request is treated as its own, unclassified thing. */
const CLEAR_SIGNAL: Partial<Record<ProductionBlueprintType, RegExp>> = {
  marketplace: /marketplace|place de march[ée]|vendeurs? et acheteurs?|sellers? and buyers?/i,
  crm: /\bcrm\b|pipeline de vente|sales pipeline|gestion des prospects/i,
  booking: /r[ée]servations?|reservations?|\bbooking\b|prise de rendez-vous|rendez-vous en ligne|appointments?/i,
  ecommerce: /e-?commerce|boutique en ligne|online (?:shop|store)|\bpanier\b|\bcart\b|checkout|vendre (?:mes|des|en ligne)/i,
  admin_dashboard: /admin dashboard|tableau de bord (?:d['’])?admin|back.?office|panneau d['’]administration/i,
  internal_tool: /outil interne|internal tool|workflow d['’]approbation|approval workflow/i,
  ai_tool: /chatbot|assistant (?:ia|ai)|outil (?:ia|d['’]ia)|\bai (?:tool|assistant|app)\b/i,
  blog_cms: /\bblog\b|\bcms\b|magazine en ligne|publier des articles/i,
  productivity_tool: /to-?do|kanban|pomodoro|gestion de t[âa]ches|task manager|liste de t[âa]ches|prise de notes|note-taking/i,
  social_platform: /r[ée]seau social|social (?:network|platform)|fil d['’]actualit[ée]s?|news ?feed|\bforum\b/i,
  education_platform: /\blms\b|e-?learning|plateforme de cours|course platform|quiz app|plateforme d['’]apprentissage/i,
  healthcare_app: /\bpatients?\b|clinique|\bclinic\b|cabinet m[ée]dical|prescriptions?/i,
  finance_tool: /\bbudget\b|facturation|invoicing|suivi des d[ée]penses|expense tracker/i,
  creative_tool: /whiteboard|[ée]diteur d['’]images?|image editor|outil de dessin|drawing tool/i,
  game_interactive: /\bjeu\b|\bgame\b|tetris|\bsnake\b|[ée]checs|\bchess\b|\bpuzzle\b|memory game/i,
  directory_listing: /annuaire|\bdirectory\b|job board|offres d['’]emploi|immobilier|real estate/i,
  communication_tool: /messagerie|chat app|application de chat|email client|\binbox\b/i,
  data_tool: /json viewer|data explorer/i,
  saas: /\bsaas\b|multi.?tenant|abonnements?/i,
};

/** The blueprint for this request, only when the request clearly describes that kind of app. */
export function detectAppKind(prompt: string): ProductionBlueprint | null {
  // The blueprints' own keywords are unaccented (« reservation »): « réservation » has to reach them too.
  const blueprint = inferProductionBlueprint(String(prompt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  if (blueprint.type === 'generic_web_app') return null;
  const signal = CLEAR_SIGNAL[blueprint.type];
  return signal && signal.test(String(prompt || '')) ? blueprint : null;
}

const list = (items: readonly string[], limit: number) => items.slice(0, limit).join(' · ');

/** The brief: short, in the coder's language (English instructions), with the person's request always ahead of it. */
export function buildAppPlaybook(prompt: string): string {
  const blueprint = detectAppKind(prompt);
  if (!blueprint) return '';
  const states = blueprint.frontend.requiredStates.filter(state => state !== 'disabled' && state !== 'success');
  const features = blueprint.backend.features.length
    ? `It usually needs ${list(blueprint.backend.features, 5)}${blueprint.backend.requiresAuth ? ' (private data behind a sign-in)' : ''}.`
    : '';
  return [
    `What people expect of a ${blueprint.label.toLowerCase()} — a checklist, not extra scope: the user's own words always win, and anything they ruled out stays out. Prefer fewer, complete screens over many thin ones.`,
    `Screens: ${list(blueprint.pages, 6)}.`,
    `Core flows to make really work: ${list(blueprint.workflows, 5)}.`,
    `Every list and every action has its ${states.join(', ')} state, written for a person, never a blank area or a raw error.`,
    features,
    `Watch for: ${list(blueprint.risks, 3)}.`,
    `Done when: ${list(blueprint.acceptanceCriteria.filter(item => !/RLS|service role|Private data paths/i.test(item)), 3)}`,
  ].filter(Boolean).join('\n');
}
