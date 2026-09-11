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

  /*
   * A plan is rendered as a plan because it is one, not because the composer
   * was set to "Plan".
   *
   * Both render paths gated on a mode instead of on the content: the live one
   * on `requestedMode === 'plan'`, the reload one on `message.intent ===
   * 'plan'`. But the router raises a plan by itself whenever a request needs
   * one (`auto_plan_required`), and in Auto neither of those says 'plan' — so
   * the common case printed the model's JSON object into the conversation,
   * braces and all, and printed it again on every reopen.
   *
   * The gates were never needed. `parsePlanPresentation` returning null for
   * prose is what keeps ordinary answers on the markdown path, and these
   * assertions are what stop a mode gate from being reintroduced in front of
   * it.
   */
  it('renders a plan raised under Auto, where no mode ever says "plan"', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../builder-live.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/requestedMode === 'plan' && renderPlanResponse\(/);
    expect(source).toMatch(/if \(renderPlanResponse\(card, content, prompt, speaksFrench\)\)/);

    // And the same on reload, so reopening a conversation does not undo it.
    expect(source).not.toMatch(/message\.intent === 'plan';/);
    expect(source).toMatch(/const storedPlan = role === 'assistant'\n\s*\? parsePlanPresentation\(/);
  });

  it('still declines prose that merely mentions a plan', () => {
    // The safety net the removed gates were standing in for: only a whole JSON
    // object becomes a card, so an ordinary answer about planning stays prose.
    expect(parsePlanPresentation('Je vous propose un plan en trois étapes avant de coder.')).toBeNull();
    expect(parsePlanPresentation('{ "title": "incomplet"')).toBeNull();
    expect(parsePlanPresentation('["features", "architecture"]')).toBeNull();
  });
});
