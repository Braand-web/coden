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
