/**
 * Who appears in the Community, and why — one function, one answer.
 *
 * Every place that asks « may this app be listed? » (publication, plan change, the owner's switch, a re-check, the admin
 * screen) calls `decideListing`. Nothing else encodes the free / paid rule, so it cannot drift between screens.
 *
 * The rule, in Coden's plans (free, pro, business, enterprise):
 *  - only a published app is ever listed; a draft, an unpublished app, or one behind a password / private access never is;
 *  - free plan: every published app is listed automatically (once the automatic checks pass);
 *  - paid plan: nothing is listed unless the owner added the app themselves, and they can change their mind any time;
 *  - official Coden templates are always visible and never go through this function's free / paid rule.
 *
 * Every decision carries a stable `code` and a French `reason`, so it can be journaled (who, what, why, when) and shown
 * to the person it concerns.
 */
export type PlanKind = 'free' | 'paid' | 'unknown';
export type ListingOrigin = 'free_auto' | 'paid_opt_in';
export type Protection = 'none' | 'password' | 'private';

export type VisibilityCode =
  | 'listable_free_auto'
  | 'listable_paid_opt_in'
  | 'not_published'
  | 'protected'
  | 'paid_not_opted_in'
  | 'plan_unknown'
  | 'grace_period'
  | 'removed_by_user'
  | 'removed_by_moderation'
  | 'listings_frozen';

export type VisibilityInput = {
  /** The app has a live public version right now. */
  published: boolean;
  protection?: Protection;
  /** The plan key of the owner's workspace (`free`, `pro`, `business`, `enterprise`). */
  plan: string | null | undefined;
  /** Paid plans: the owner switched « Ajouter à la communauté » on. */
  optedIn?: boolean;
  /** The owner took the app out (unpublished, deleted, or removed it from the Community). */
  removedByUser?: boolean;
  /** Moderation removed it. A moderator's decision outlasts every other rule until they lift it. */
  removedByModeration?: boolean;
  /** Admin kill switch « geler les nouveaux listings »: it stops new listings, never removes the ones already online. */
  listingsFrozen?: boolean;
  /** The app is already online in the Community (a freeze does not touch it). */
  alreadyListed?: boolean;
  /** Paid → free: an app kept private is not listed before this moment (the 14-day notice). */
  autoListNotBefore?: string | Date | null;
  now?: Date;
};

export type VisibilityDecision = {
  listable: boolean;
  /** Why it may be listed: automatically (free) or by the owner's choice (paid). `null` when it may not be. */
  origin: ListingOrigin | null;
  code: VisibilityCode;
  /** A sentence for the person it concerns. */
  reason: string;
};

const FREE_KEYS = new Set(['free', 'gratuit', 'starter_free']);
const PAID_KEYS = new Set(['pro', 'business', 'enterprise']);

/**
 * `free` and `paid` are Coden's plans; anything else is `unknown`, which is treated like a paid plan (nothing listed
 * without the owner's say-so): when in doubt, a private app stays private.
 */
export function planKind(plan: string | null | undefined): PlanKind {
  const key = String(plan || '').trim().toLowerCase();
  if (FREE_KEYS.has(key)) return 'free';
  if (PAID_KEYS.has(key)) return 'paid';
  return 'unknown';
}

const decision = (listable: boolean, origin: ListingOrigin | null, code: VisibilityCode, reason: string): VisibilityDecision => ({ listable, origin, code, reason });

export function decideListing(input: VisibilityInput): VisibilityDecision {
  // Strongest first: a person or a moderator taking an app out is never overridden by a plan rule.
  if (input.removedByModeration) return decision(false, null, 'removed_by_moderation', 'Cette app a été retirée de la Communauté par la modération.');
  if (input.removedByUser) return decision(false, null, 'removed_by_user', 'Vous avez retiré cette app de la Communauté.');
  if (!input.published) return decision(false, null, 'not_published', 'Seules les apps publiées peuvent apparaître dans la Communauté.');
  if ((input.protection || 'none') !== 'none') return decision(false, null, 'protected', 'Une app protégée (mot de passe ou accès privé) n’apparaît jamais dans la Communauté.');

  const kind = planKind(input.plan);
  let origin: ListingOrigin;
  if (kind === 'free') {
    const notBefore = input.autoListNotBefore ? new Date(input.autoListNotBefore).getTime() : 0;
    const now = (input.now || new Date()).getTime();
    if (Number.isFinite(notBefore) && notBefore > now && !input.optedIn) {
      return decision(false, null, 'grace_period', 'Cette app n’apparaîtra pas avant la fin du préavis de 14 jours qui suit le passage au plan gratuit.');
    }
    origin = 'free_auto';
  } else {
    if (!input.optedIn) {
      return decision(false, null, kind === 'unknown' ? 'plan_unknown' : 'paid_not_opted_in', 'Sur un plan payant, une app n’apparaît dans la Communauté que si vous l’ajoutez.');
    }
    origin = 'paid_opt_in';
  }

  // A freeze stops new listings only: an app already online stays, and is re-checked like any other.
  if (input.listingsFrozen && !input.alreadyListed) {
    return decision(false, null, 'listings_frozen', 'Les nouveaux listings sont momentanément suspendus. Votre app sera ajoutée dès leur reprise.');
  }
  return origin === 'free_auto'
    ? decision(true, origin, 'listable_free_auto', 'Plan gratuit : les apps publiées apparaissent dans la Communauté après vérification.')
    : decision(true, origin, 'listable_paid_opt_in', 'Vous avez ajouté cette app à la Communauté.');
}

/**
 * What a person sees about their own app: the decision turned into the two facts the screen needs — may they change the
 * choice, and what does the switch say. Free plan: the rule is fixed, with a way to choose by upgrading.
 */
export function ownerControls(plan: string | null | undefined): { canChoose: boolean; mode: 'automatic' | 'choice' } {
  return planKind(plan) === 'free' ? { canChoose: false, mode: 'automatic' } : { canChoose: true, mode: 'choice' };
}

/** The sentence shown at publication time on the free plan; never blocks the publication. */
export const FREE_PUBLISH_NOTICE =
  'Sur le plan gratuit, cette app apparaîtra dans la Communauté dans quelques minutes. Vous pouvez modifier le titre, la description et la catégorie. Passez à un plan payant pour choisir.';
export const PAID_PUBLISH_NOTICE = 'Sur votre plan, cette app reste privée tant que vous ne l’ajoutez pas à la Communauté.';

export const GRACE_DAYS = 14;
export const graceEndsAt = (from: Date = new Date()): Date => new Date(from.getTime() + GRACE_DAYS * 86_400_000);
