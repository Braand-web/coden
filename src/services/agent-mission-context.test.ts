import { describe, expect, it } from 'vitest';
import { buildMissionContext, isShortConfirmation } from './agent-mission-context';

describe('a short confirmation carries out what was just proposed', () => {
  it('recognises answers, not requests', () => {
    for (const prompt of ['oui', 'Ok', 'vas-y !', 'continue', 'D’accord.', 'yes', 'corrige tout']) expect(isShortConfirmation(prompt), prompt).toBe(true);
    for (const prompt of ['oui mais avec un thème sombre', 'ajoute un bouton', 'Crée une calculatrice', '']) expect(isShortConfirmation(prompt), prompt).toBe(false);
  });

  it('makes « oui » mean the proposal above it', () => {
    const { text } = buildMissionContext({
      prompt: 'oui',
      history: [{ role: 'user', content: 'je veux une liste de tâches' }, { role: 'assistant', content: 'Je te propose une liste avec filtres et un thème clair. Je lance ?' }, { role: 'user', content: 'oui' }],
      fileCount: 3,
    });
    expect(text).toMatch(/carry out that proposal now/);
    expect(text).toMatch(/Je te propose une liste avec filtres/);
  });

  it('leaves a real request and a bare « oui » with no proposal as they are', () => {
    expect(buildMissionContext({ prompt: 'Crée une calculatrice', history: [{ role: 'assistant', content: 'Bonjour' }], fileCount: 0 }).text).toMatch(/Current user mission:\nCrée une calculatrice/);
    expect(buildMissionContext({ prompt: 'oui', fileCount: 0 }).text).toMatch(/Current user mission:\noui/);
  });
});
