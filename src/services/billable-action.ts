import type { BillableAction } from '../config/billing-v2.ts';

export type BillableIntent = {
  intent?: string | null;
  requiresFileChanges?: boolean;
};

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

/**
 * Map the requested outcome to the public action table. Component nouns do
 * not override an explicitly style-only edit: “change the button colour” is
 * a targeted style, while “add a button” is a component change.
 */
export function classifyBillableAction(prompt: string, intent: BillableIntent): BillableAction | 'conversation' {
  if (intent.intent === 'plan') return 'plan';
  if (!intent.requiresFileChanges) return 'conversation';

  const text = normalize(String(prompt || ''));
  if (/\b(page complete|full page|nouvelle page|new page|landing page|ecran complet|new screen|nouvel ecran)\b/.test(text)) return 'full_page';
  if (/\b(fonctionnalite|feature|auth|paiement|payment|checkout|database|base de donnees|recherche|search|filtre|filter|panier|cart|workflow|integration)\b/.test(text)) return 'feature';

  const styleSignal = /\b(style|styliser|couleur|color|police|font|espacement|spacing|padding|margin|alignement|alignment|ombre|shadow|bordure|border|theme|radius|taille|size|largeur|width|hauteur|height)\b/.test(text);
  const structuralSignal = /\b(ajoute|ajouter|add|cree|creer|create|nouveau|nouvelle|new|supprime|supprimer|delete|remove|remplace|remplacer|replace)\b/.test(text);
  if (styleSignal && !structuralSignal) return 'targeted_style';

  if (/\b(composant|component|bouton|button|header|footer|navbar|navigation|formulaire|form|modal|carte|card|tableau|table)\b/.test(text)) return 'component';
  if (styleSignal) return 'targeted_style';
  return 'feature';
}
