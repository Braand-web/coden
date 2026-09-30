/**
 * Stage one: a few microseconds, no network.
 *
 * Lets the clear and the safe through, refuses what the protected core
 * refuses, and says "doubt" for the rest — the only actions that ever wait for
 * a model. Every verdict names its stage and rule so the journal can say why.
 */
import { actionTargets, alwaysAskCategories, findConsent } from './consent.ts';
import { hardRules } from './hard-rules.ts';
import { lightCheck } from './light-check.ts';
import { bareName, judgePackage } from './packages.ts';
import { categoryOf, isReadOnlyIntegrationTool, tierOf } from './action-tiers.ts';
import type { ActionCategory, ActionTier, GuardContext, GuardDecisionKind, GuardStage, ToolAction } from './action-types.ts';
import { needsConfirmation } from '../preview-tool/preview-policy.ts';

export type FastVerdict =
  | { kind: 'decided'; decision: GuardDecisionKind; category: ActionCategory; tier: ActionTier; stage: GuardStage; reason: string; question?: string; rule?: string }
  | { kind: 'doubt'; category: ActionCategory; tier: ActionTier; why: string; fallback: { decision: GuardDecisionKind; reason: string; question?: string } };

/** What the question says, in words a person uses. No tool names, no parameters, no jargon. */
export function plainQuestion(category: ActionCategory, action: ToolAction): string {
  const target = actionTargets(action)[0];
  switch (category) {
    case 'deploy': return 'Je vais mettre en ligne ton site. Confirmer ?';
    case 'email': return target ? `Je vais envoyer un vrai e-mail à ${target}. Confirmer ?` : 'Je vais envoyer un vrai e-mail. Confirmer ?';
    case 'sms': return target ? `Je vais envoyer un vrai SMS au ${target}. Confirmer ?` : 'Je vais envoyer un vrai SMS. Confirmer ?';
    case 'payment': return 'Je vais effectuer une opération de paiement. Confirmer ?';
    case 'database': return 'Je vais modifier ou supprimer des données de ta base. Confirmer ?';
    case 'secrets': return 'Je vais modifier une clé ou une variable secrète du projet. Confirmer ?';
    case 'permissions': return 'Je vais changer des accès ou des droits. Confirmer ?';
    case 'mass_delete': return 'Je vais supprimer un grand nombre de fichiers du projet. Confirmer ?';
    case 'ui_action': return 'Je vais effectuer une action qui a des conséquences dans ton application. Confirmer ?';
    case 'install': return 'Je vais ajouter un paquet que je ne connais pas bien. Confirmer ?';
    default: return 'Je vais agir sur un service connecté à ton compte. Confirmer ?';
  }
}

/** Options that carry the action in the person's own voice: their answer is then the consent the next check reads. */
export function confirmationOptions(category: ActionCategory): string[] {
  switch (category) {
    case 'deploy': return ['Oui, mets le site en ligne', 'Non, ne mets rien en ligne'];
    case 'email': return ['Oui, envoie cet e-mail', 'Non, n’envoie rien'];
    case 'sms': return ['Oui, envoie ce SMS', 'Non, n’envoie rien'];
    case 'payment': return ['Oui, effectue ce paiement', 'Non, annule'];
    case 'database': return ['Oui, modifie ou supprime ces données', 'Non, ne touche pas aux données'];
    case 'secrets': return ['Oui, modifie cette variable secrète', 'Non, ne touche pas aux secrets'];
    case 'permissions': return ['Oui, change ces accès', 'Non, ne change rien'];
    case 'mass_delete': return ['Oui, supprime tous ces fichiers', 'Non, garde-les'];
    case 'install': return ['Oui, installe ce paquet', 'Non, cherche une autre solution'];
    default: return ['Oui, confirme cette action', 'Non, annule'];
  }
}

const OUTWARD: ReadonlySet<ActionCategory> = new Set(['deploy', 'database', 'email', 'sms', 'payment', 'secrets', 'permissions', 'mass_delete', 'ui_action', 'third_party']);

const PRIVATE_HOST = /^(?:localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\d{1,3}(?:\.\d{1,3}){3})$/i;

/** A public documentation-style page: https, a real name, no credentials, no payload smuggled into the address. */
function plainPublicUrl(raw: unknown): boolean {
  try {
    const url = new URL(String(raw));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (url.username || url.password || PRIVATE_HOST.test(url.hostname)) return false;
    if (url.search.length > 300 || url.href.length > 600) return false;
    // A long opaque run in the address is how data leaves in a GET. A readable slug is not one.
    const segments = decodeURIComponent(url.pathname + '&' + url.search).split(/[/&=?]+/);
    if (segments.some(segment => segment.length >= 40 && !/^[a-z0-9]+(?:[-_][a-z0-9]+){2,}$/i.test(segment) || segment.length >= 72)) return false;
    return true;
  } catch { return false; }
}

export function fastFilter(action: ToolAction, context: GuardContext): FastVerdict {
  const category = categoryOf(action);
  const tier = tierOf(action);

  // The protected core first, whatever the tier: nothing below can lift it.
  const hard = hardRules(action, context);
  if (hard) return { kind: 'decided', decision: 'block', category, tier, stage: 'hard_rule', reason: hard.reason, rule: hard.rule };

  if (tier === 1) return { kind: 'decided', decision: 'allow', category, tier, stage: 'tier', reason: 'Lecture ou navigation dans le projet.' };

  if (tier === 2) {
    const light = lightCheck(action);
    if (!light.ok) return { kind: 'decided', decision: 'block', category, tier, stage: 'light_check', reason: light.reason, rule: light.rule };
    return { kind: 'decided', decision: 'allow', category, tier, stage: 'light_check', reason: 'Modification du projet, sans secret en clair.' };
  }

  // Tier 3.
  const asked = alwaysAskCategories(context.rules);
  const messages = context.userMessages;

  if (category === 'network') {
    const target = action.tool === 'fetch_url' ? action.args.url : 'https://search.invalid/';
    if (action.tool === 'web_search') {
      const query = String(action.args.query ?? '');
      return query.length <= 400
        ? { kind: 'decided', decision: 'allow', category, tier, stage: 'fast', reason: 'Recherche web.' }
        : { kind: 'doubt', category, tier, why: 'a very long search query', fallback: { decision: 'block', reason: 'Cette recherche contient trop de texte : reformule-la en quelques mots.' } };
    }
    return plainPublicUrl(target)
      ? { kind: 'decided', decision: 'allow', category, tier, stage: 'fast', reason: 'Lecture d’une page publique.' }
      : { kind: 'doubt', category, tier, why: 'an address that is private, carries credentials or a long opaque payload', fallback: { decision: 'block', reason: 'Cette adresse n’est pas une page publique ordinaire (adresse privée, identifiants ou données dans l’URL).' } };
  }

  if (category === 'shell') {
    // The command policy already admits only finite project tooling; the protected core has looked at the rest.
    return { kind: 'decided', decision: 'allow', category, tier, stage: 'fast', reason: 'Commande de vérification du projet.' };
  }

  if (category === 'install') {
    const name = bareName(String(action.args.name ?? ''));
    const said = messages.join('\n').toLowerCase();
    if (asked.has('install') && !findConsent('install', action, messages, { onlyLast: true }).explicit && !said.includes(name)) {
      return { kind: 'decided', decision: 'ask', category, tier, stage: 'fast', reason: 'Une règle demande de confirmer chaque installation.', question: plainQuestion('install', action), rule: 'project_rule' };
    }
    if (name && said.includes(name)) return { kind: 'decided', decision: 'allow', category, tier, stage: 'fast', reason: 'Paquet demandé par l’utilisateur.' };
    const judged = judgePackage(name);
    if (judged.verdict === 'known') return { kind: 'decided', decision: 'allow', category, tier, stage: 'fast', reason: 'Paquet courant.' };
    if (judged.verdict === 'lookalike') {
      return { kind: 'doubt', category, tier, why: `a name one character from a well-known package (${judged.meant})`, fallback: { decision: 'block', reason: `« ${name} » ressemble à « ${judged.meant} » : vérifie l’orthographe du paquet.` } };
    }
    return { kind: 'doubt', category, tier, why: 'a package that is not on the list of common ones', fallback: { decision: 'allow', reason: 'Paquet inconnu, installé sans exécuter ses scripts, dans un environnement isolé.' } };
  }

  /*
   * A click in the preview of the app being built. The preview tool has already refused to click
   * anything with a real-world effect unless the agent says the person asked for it, and the
   * protected core above has looked at it. Asking the person here stopped finished apps to confirm
   * a calculator's « Effacer », and the answer restarted the whole run.
   */
  if (category === 'ui_action' && !needsConfirmation([action.args.text, action.args.name, action.args.selector, action.args.label].filter(Boolean).join(' '))) {
    return { kind: 'decided', decision: 'allow', category, tier, stage: 'fast', reason: 'Clic dans l’aperçu de l’application en construction.' };
  }

  // Outward categories: consent, or a question.
  const tool = String(action.args.tool ?? '');
  if (action.tool === 'run_integration_tool' && isReadOnlyIntegrationTool(tool)) {
    return { kind: 'decided', decision: 'allow', category: 'read', tier, stage: 'fast', reason: 'Lecture sur un service connecté.' };
  }
  const consentCategory = category === 'third_party' ? 'third_party' : category;
  const needsLastMessage = asked.has(category);
  const consent = findConsent(consentCategory, action, messages, { onlyLast: needsLastMessage });
  if (consent.explicit) {
    return { kind: 'decided', decision: 'allow', category, tier, stage: 'fast', reason: `Demandé par l’utilisateur (« ${consent.excerpt} »).` };
  }
  if (needsLastMessage) {
    return { kind: 'decided', decision: 'ask', category, tier, stage: 'fast', reason: 'Une règle du projet demande de confirmer cette action à chaque fois.', question: plainQuestion(category, action), rule: 'project_rule' };
  }
  const fallback = OUTWARD.has(category)
    ? { decision: 'ask' as const, reason: consent.missingTarget ? 'La personne n’a pas indiqué ce destinataire.' : 'Cette action n’a pas été demandée explicitement.', question: plainQuestion(category, action) }
    : { decision: 'allow' as const, reason: 'Action locale.' };
  return { kind: 'doubt', category, tier, why: consent.missingTarget ? 'the recipient was not named by the user' : 'no explicit instruction for this action in the user\'s messages', fallback };
}
