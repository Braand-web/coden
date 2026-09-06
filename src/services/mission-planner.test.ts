import { describe, expect, it } from 'vitest';
import { resolveCodenSkillPlan } from './coden-skill-plan';
import { planMission } from './mission-planner';

describe('Coden V4 mission planner', () => {
  it('keeps a trivial visual edit minimal', () => {
    const skillPlan = resolveCodenSkillPlan({ prompt: 'Change le bleu en vert', intent: 'edit', complexity: 'simple', fileCount: 2 });
    const mission = planMission({ runId: 'run-1', prompt: 'Change le bleu en vert', intent: 'edit', complexity: 'simple', files: [{ path: 'src/App.tsx' }], selectedModel: 'openai/gpt-5.6-terra', skillPlan });
    expect(mission.profile.complexity).toBe('trivial');
    expect(mission.profile.requiresDesign).toBe(true);
    expect(mission.graph).toHaveLength(1);
    expect(mission.graph[0].selectedSkills).toEqual(['incremental-implementation']);
  });

  it('builds a dependency graph and reserves database files for the database writer', () => {
    const prompt = 'Crée un CRM Supabase avec auth, design responsive et publie-le';
    const skillPlan = resolveCodenSkillPlan({ prompt, intent: 'build', complexity: 'complex', fileCount: 30, risk: 'high' });
    const mission = planMission({ runId: 'run-2', prompt, intent: 'build', complexity: 'complex', risk: 'high', selectedModel: 'openai/gpt-5.6-sol', skillPlan, files: [{ path: 'src/App.tsx' }, { path: 'supabase/migrations/001.sql' }] });
    expect(mission.profile).toMatchObject({ requiresDatabase: true, requiresAuth: true, requiresDesign: true, requiresBrowserQA: true });
    expect(mission.graph.every(node => node.selectedSkills.length <= 3)).toBe(true);
    expect(mission.graph.flatMap(node => node.dependencies).every(id => id.startsWith('run-2:'))).toBe(true);
    const database = mission.graph.find(node => node.assignedAgent === 'database');
    expect(database?.fileReservations).toContain('supabase/migrations/001.sql');
  });
});
