import { describe, expect, it } from 'vitest';
import { classifyGeneratedAppType } from './design-generation-policy';
import { blocksTheRun, gatePlatformType } from './quality-gate-policy';

describe('what kind of product the checks are held to', () => {
  it('a calculator, a to-do list and a small tool are not read as a CRM, a shop or a clinic', () => {
    for (const prompt of [
      'cree une mini calculatrice avec les quatre opérations',
      'inspire toi de ce design pour taskflow',
      'un chronomètre tout simple',
      'un chronomètre avec des opérations de base',
    ]) expect(gatePlatformType(prompt, false), prompt).toBe('generic_web_app');
  });

  it('a request that names the product keeps its product-specific checks', () => {
    expect(gatePlatformType('Une boutique en ligne pour vendre mes bougies avec un panier', false)).toBe('ecommerce');
    expect(gatePlatformType('Un CRM avec un pipeline de vente', false)).toBe('crm_erp');
  });

  it('the earlier behaviour comes back with the strict switch', () => {
    expect(gatePlatformType('cree une mini calculatrice', true)).toBe(classifyGeneratedAppType('cree une mini calculatrice'));
  });

  it('a keyword is a word: « ios » is not in « curiosity », « erp » is not in « properly »', () => {
    expect(classifyGeneratedAppType('a curiosity cabinet')).not.toBe('mobile_first_app');
    expect(classifyGeneratedAppType('make it work properly')).not.toBe('crm_erp');
    expect(classifyGeneratedAppType('un CRM pour mes prospects')).toBe('crm_erp');
    expect(classifyGeneratedAppType('suivi des leads et pipelines')).toBe('crm_erp');
  });
});

describe('what may send a working app back for another round', () => {
  const fail = (key: string) => ({ key, status: 'fail', severity: 'high' });

  it('taste and scores are evidence, never a blocker', () => {
    for (const key of ['design_platform_fit', 'design_no_ai_gradient', 'design_score', 'functionality_score', 'visual_interaction_probe_score', 'design_no_generic_copy']) {
      expect(blocksTheRun(fail(key), false), key).toBe(false);
      expect(blocksTheRun(fail(key), true), key).toBe(true);
    }
  });

  it('a concrete failure still blocks, and a pass or a warning never does', () => {
    expect(blocksTheRun(fail('functionality_primary_controls'), false)).toBe(true);
    expect(blocksTheRun(fail('visual_no_dead_primary_controls'), false)).toBe(true);
    expect(blocksTheRun({ key: 'design_score', status: 'pass', severity: 'low' }, true)).toBe(false);
    expect(blocksTheRun({ key: 'design_touch_targets', status: 'warn', severity: 'medium' }, true)).toBe(false);
  });
});

describe('a small request is finished when it works', async () => {
  const { isSmallRequest } = await import('./quality-gate-policy');
  const { NO_OP_WHEN_NOTHING_TO_UNDO } = await import('./sandbox/acceptance');
  const { DESIGN_REVIEW_PASS_SCORE } = await import('./design-review-agent');

  it('reads a mini tool as small, and a real product as not', () => {
    for (const prompt of ['cree une mini calculatrice', 'Une calculatrice', 'un chronomètre tout simple', 'make a simple todo app', 'une liste de tâches', 'Un petit jeu de morpion']) expect(isSmallRequest(prompt), prompt).toBe(true);
    for (const prompt of ['', 'Une boutique en ligne pour vendre mes bougies avec un panier et le paiement', 'Crée un CRM complet avec pipeline, rapports et gestion des équipes commerciales pour ma PME', 'Un site vitrine premium pour la marque O’Tea avec un blog et une page contact']) expect(isSmallRequest(prompt), prompt).toBe(false);
  });

  it('a clear or undo control pressed when there is nothing to undo is not a dead control', () => {
    for (const label of ['Effacer', 'Supprimer le dernier chiffre', 'Changer le signe', '+/-', '±', '⌫', 'C', 'AC', 'Annuler', 'Fermer', 'Réinitialiser']) expect(NO_OP_WHEN_NOTHING_TO_UNDO.test(label), label).toBe(true);
    for (const label of ['Ajouter une tâche', 'Diviser', 'Calculer', 'Créer une demande', 'Publier', 'Cocher']) expect(NO_OP_WHEN_NOTHING_TO_UNDO.test(label), label).toBe(false);
  });

  it('the designer\'s review asks for a polish round only for a clearly weak result', () => {
    expect(DESIGN_REVIEW_PASS_SCORE).toBeLessThanOrEqual(6);
  });
});

describe('a small request keeps a small plan and a small run', async () => {
  const { resolveQualityPolicy } = await import('./quality-tier');
  const { runPlannerAgent } = await import('./planner-agent');
  const plannerSource = (await import('node:fs')).readFileSync('src/services/planner-agent.ts', 'utf8');

  it('no specialists and no designer review for a mini tool, even at the highest level; a real product keeps them', () => {
    const small = resolveQualityPolicy({ route: 'new_project', effort: 'Ultra', credits: 500, prompt: 'cree une mini calculatrice' });
    expect(small).toMatchObject({ specialists: false, designReview: false, acceptance: true, explore: true });
    const big = resolveQualityPolicy({ route: 'new_project', effort: 'Ultra', credits: 500, prompt: 'Une boutique en ligne pour vendre mes bougies avec un panier et le paiement' });
    expect(big).toMatchObject({ specialists: true, designReview: true });
  });

  it('the planner is told to size the plan to the request, and is asked for no scenario about history or saved data', () => {
    expect(plannerSource).toMatch(/smallest complete version of exactly what was asked/);
    expect(plannerSource).toMatch(/isSmallRequest\(input\.userRequest \?\? input\.prompt\)/);
    expect(typeof runPlannerAgent).toBe('function');
  });
});

describe('the specialists are chosen from what was written, not from the scaffold', async () => {
  const { STARTER_KIT_FILES } = await import('./sandbox/starter-kit');
  const { selectAgentsForContext } = await import('./parallel-agent-runner');
  const pipeline = (await import('node:fs')).readFileSync('src/services/multi-agent-pipeline.ts', 'utf8');
  const database = /\b(database|supabase|postgres|sql|crud|base de donn)/i;

  it('the pipeline reads the signals from what was written for the project, not from what every project starts with', () => {
    expect(STARTER_KIT_FILES.length).toBeGreaterThan(0);
    expect(database.test('x')).toBe(false);
    expect(pipeline).toMatch(/scaffold\.get\(file\.path\) !== file\.content && !startsWithEveryProject\(file\.path\)/);
    expect(pipeline).not.toMatch(/Object\.keys\(input\.backendEnv \|\| \{\}\)\.some\(key => \/SUPABASE\|DATABASE\/i\.test\(key\)\)\s*\n\s*\|\|/);
  });

  it('a design request on a finished calculator asks for no backend engineer', () => {
    const roles = selectAgentsForContext({ projectName: 'calc', userPrompt: 'optimise le design', appType: 'generic_web_app', fileCount: 3, files: [{ path: 'src/App.tsx', content: 'export default function App(){return null}' }], hasAuth: false, hasDatabase: false, hasPayments: false, language: 'fr', availableModels: {} as any } as any);
    expect(roles).not.toContain('backend_engineer');
    expect(roles).not.toContain('security_auditor');
  });
});
