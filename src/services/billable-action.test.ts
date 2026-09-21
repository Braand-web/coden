import { describe, expect, it } from 'vitest';
import { classifyBillableAction } from './billable-action';

const edit = { intent: 'generate_or_edit', requiresFileChanges: true };

describe('public billable action classification', () => {
  it.each([
    ['Change la couleur du bouton principal', 'targeted_style'],
    ['Augmente le padding de la carte', 'targeted_style'],
    ['Ajoute un bouton de retour', 'component'],
    ['Modifie le composant de navigation', 'component'],
    ['Ajoute une authentification par email', 'feature'],
    ['Crée une nouvelle page de tarifs', 'full_page'],
  ] as const)('%s → %s', (prompt, expected) => {
    expect(classifyBillableAction(prompt, edit)).toBe(expected);
  });

  it('prices an explicit plan separately from a conversation', () => {
    expect(classifyBillableAction('Prépare le plan', { intent: 'plan', requiresFileChanges: false })).toBe('plan');
    expect(classifyBillableAction('Merci', { intent: 'conversation', requiresFileChanges: false })).toBe('conversation');
  });
});
