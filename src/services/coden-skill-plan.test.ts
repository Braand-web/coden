import { describe, expect, it } from 'vitest';
import { CODEN_CAPABILITY_SKILLS, resolveCodenSkillPlan } from './coden-skill-plan';
import { AUDITED_SKILL_REPOSITORIES, validateSkillProvenance } from './coden-skill-provenance';

describe('Coden capability skill planner', () => {
  it('publishes the complete eighteen-skill catalogue', () => {
    expect(CODEN_CAPABILITY_SKILLS).toHaveLength(18);
    expect(new Set(CODEN_CAPABILITY_SKILLS.map(skill => skill.id)).size).toBe(18);
  });

  it('pins audited upstream repositories and valid runtime provenance', () => {
    expect(AUDITED_SKILL_REPOSITORIES).toHaveLength(12);
    expect(AUDITED_SKILL_REPOSITORIES.every(repository => /^[a-f0-9]{40}$/.test(repository.commit))).toBe(true);
    expect(validateSkillProvenance()).toEqual([]);
  });

  it('keeps a simple visual edit small', () => {
    const plan = resolveCodenSkillPlan({ prompt: 'Change le bleu en vert', intent: 'edit', complexity: 'simple', fileCount: 8 });
    expect(plan.selectedSkillIds).toEqual(['incremental-implementation']);
    expect(plan.requiresDesignGate).toBe(true);
  });

  it('composes a full-stack Supabase build without overloading a node', () => {
    const plan = resolveCodenSkillPlan({ prompt: 'Crée un CRM moderne avec Supabase, auth et responsive', intent: 'build', complexity: 'complex', fileCount: 24, risk: 'high' });
    expect(plan.selectedSkillIds).toEqual(expect.arrayContaining([
      'architecture-and-domain', 'multi-agent-orchestration', 'database-and-migrations',
      'frontend-design', 'browser-and-visual-qa', 'independent-verification',
    ]));
    expect(plan.nodes.every(node => node.skillIds.length <= 3)).toBe(true);
    expect(plan.requiresFunctionalGate).toBe(true);
    expect(plan.requiresDesignGate).toBe(true);
    const phaseNodes = new Map(plan.nodes.map(node => [node.id, node]));
    for (const node of plan.nodes) {
      expect(node.dependsOn.every(id => phaseNodes.get(id)?.phase !== node.phase)).toBe(true);
    }
  });

  it('uses root-cause debugging and browser evidence for a broken form', () => {
    const plan = resolveCodenSkillPlan({ prompt: 'Le formulaire plante après connexion', intent: 'debug_fix', complexity: 'medium', fileCount: 12 });
    expect(plan.selectedSkillIds).toEqual(expect.arrayContaining(['systematic-debugging', 'browser-and-visual-qa', 'independent-verification']));
  });
});
