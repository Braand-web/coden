import { describe, expect, it } from 'vitest';
import { parsePlanPresentation } from './plan-presentation';

describe('plan presentation', () => {
  it('turns the legacy product-plan JSON into safe labelled sections', () => {
    const plan = parsePlanPresentation(JSON.stringify({
      title: 'Plan de conception : To-do élégante',
      objective: 'Créer une application de tâches fluide avec persistance locale.',
      features: ['Ajout rapide de tâches', 'Filtres toutes / en cours / terminées'],
      architecture: ['src/App.tsx : orchestration', 'src/hooks/useTodos.ts : persistance'],
    }));

    expect(plan).toMatchObject({
      title: 'Plan de conception : To-do élégante',
      summary: 'Créer une application de tâches fluide avec persistance locale.',
    });
    expect(plan?.sections).toEqual([
      { id: 'features', items: ['Ajout rapide de tâches', 'Filtres toutes / en cours / terminées'] },
      { id: 'architecture', items: ['src/App.tsx : orchestration', 'src/hooks/useTodos.ts : persistance'] },
    ]);
  });

  it('supports the planner file contract without exposing object JSON', () => {
    const plan = parsePlanPresentation('```json\n' + JSON.stringify({
      summary: 'Une page de réservation sera ajoutée avec validation côté client.',
      files: [{ action: 'edit', path: 'src/App.tsx', rationale: 'Ajouter le flux de réservation.' }],
      risks: ['La clé de paiement devra être configurée avant publication.'],
    }) + '\n```');

    expect(plan?.title).toBe('Plan');
    expect(plan?.sections).toContainEqual({
      id: 'files',
      items: ['edit · src/App.tsx — Ajouter le flux de réservation.'],
    });
    expect(plan?.sections).toContainEqual({
      id: 'risks',
      items: ['La clé de paiement devra être configurée avant publication.'],
    });
  });

  it('leaves normal assistant prose alone', () => {
    expect(parsePlanPresentation('Voici une réponse conversationnelle normale.')).toBeNull();
  });
});
