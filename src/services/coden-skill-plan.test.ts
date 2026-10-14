import { describe, expect, it } from 'vitest';
import { CODEN_CAPABILITY_SKILLS, resolveCodenSkillPlan } from './coden-skill-plan';
import { AUDITED_SKILL_REPOSITORIES, validateSkillProvenance } from './coden-skill-provenance';

describe('Coden capability skill planner', () => {
  it('publishes the complete twenty-skill catalogue', () => {
    expect(CODEN_CAPABILITY_SKILLS).toHaveLength(20);
    expect(new Set(CODEN_CAPABILITY_SKILLS.map(skill => skill.id)).size).toBe(20);
  });

  it('pins audited upstream repositories and valid runtime provenance', () => {
    expect(AUDITED_SKILL_REPOSITORIES).toHaveLength(14);
    expect(AUDITED_SKILL_REPOSITORIES.every(repository => /^[a-f0-9]{40}$/.test(repository.commit))).toBe(true);
    expect(validateSkillProvenance()).toEqual([]);
  });

  it('keeps a simple visual edit small', () => {
    const plan = resolveCodenSkillPlan({ prompt: 'Change le bleu en vert', intent: 'edit', complexity: 'simple', fileCount: 8 });
    expect(plan.selectedSkillIds).toEqual(['incremental-implementation']);
    expect(plan.requiresDesignGate).toBe(true);
  });

  it('loads the landing page skill only for a landing page mission', () => {
    const landing = resolveCodenSkillPlan({ prompt: 'Crée une landing page SaaS avec un hero et un CTA', intent: 'build', complexity: 'medium', fileCount: 6 });
    const dashboard = resolveCodenSkillPlan({ prompt: 'Crée un dashboard SaaS', intent: 'build', complexity: 'medium', fileCount: 6 });
    expect(landing.selectedSkillIds).toContain('landing-page-design');
    expect(landing.requiresDesignGate).toBe(true);
    expect(dashboard.selectedSkillIds).not.toContain('landing-page-design');
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

  it('loads REA-inspired evidence discipline only for explicit reverse-engineering work', () => {
    const reverse = resolveCodenSkillPlan({ prompt: 'Reverse engineer the behavior of this app and explain how its onboarding works', intent: 'research', complexity: 'medium' });
    const sourceReview = resolveCodenSkillPlan({ prompt: 'Review this source repository architecture', intent: 'review', complexity: 'medium', fileCount: 12 });
    expect(reverse.selectedSkillIds).toContain('reverse-engineer-anything');
    expect(reverse.nodes.find(node => node.skillIds.includes('reverse-engineer-anything'))?.phase).toBe('inspect');
    expect(sourceReview.selectedSkillIds).not.toContain('reverse-engineer-anything');
    expect(CODEN_CAPABILITY_SKILLS.find(skill => skill.id === 'reverse-engineer-anything')?.instruction).toContain('Coden currently provides no REA MCP server');
  });

  it('applies Impeccable principles to the native frontend design skill without claiming its CLI', () => {
    const design = CODEN_CAPABILITY_SKILLS.find(skill => skill.id === 'frontend-design')!;
    expect(design.instruction).toContain('Persuade, Operate, Read or Experience');
    expect(design.instruction).toContain('Do not claim upstream Impeccable scripts');
  });
});
