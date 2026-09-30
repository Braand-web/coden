import { describe, expect, it } from 'vitest';
import { AI_MODEL_CAPABILITIES } from '../../config/ai-models';
import { createAgentTeam, modelForSubagent, TEAM_TOOL_NAMES, TEAM_TOOL_SCHEMAS } from './team';
import { openLibrarySession } from './store';
import { subagentLimits } from './subagents';

/*
 * The team against a scripted model: each sub-agent's model tries to write
 * outside its files, then inside them, then reports. No provider is called.
 */
const SANDBOX_SCHEMAS = ['list_files', 'read_file', 'write_file', 'edit_file', 'delete_file', 'install_package', 'run_command', 'request_decision'].map(name => ({ name, description: name, parameters: { type: 'object', properties: {} } }));

function scriptedGateway(script: (system: string, step: number) => any) {
  const steps = new Map<string, number>();
  const seenTools: string[][] = [];
  return {
    seenTools,
    chat: async (_model: string, messages: any[], options: any) => {
      const system = String(messages[0]?.content || '');
      const step = steps.get(system) || 0;
      steps.set(system, step + 1);
      seenTools.push((options?.tools || []).map((tool: any) => tool.function.name));
      return { text: '', model: 'test', usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }, cost_usd: 0.001, ...script(system, step) };
    },
  };
}

const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

describe('the master’s team', () => {
  it('gives the master three tools, and sub-agents none of them (depth 1)', async () => {
    expect([...TEAM_TOOL_NAMES]).toEqual(['delegate_to_subagents', 'save_skill', 'record_error_lesson']);
    const writes: string[] = [];
    const gateway = scriptedGateway((system, step) => {
      const own = system.includes('src/ui/') ? 'src/ui/Card.tsx' : 'src/lib/api.ts';
      if (step === 0) return { tool_calls: [call('a', 'write_file', { path: 'src/App.tsx', content: 'x' })] };
      if (step === 1) return { tool_calls: [call('b', 'write_file', { path: own, content: 'x' })] };
      return { text: `Livré ${own}. Dépendance nécessaire : zod.` };
    });
    const session = openLibrarySession({ requestId: 'r', contributor: 'c', shareAllowed: true, projectLibraries: {} });
    const views: string[][] = [];
    const team = createAgentTeam({
      gateway: gateway as any, store: null, session, limits: subagentLimits({}), plan: 'business',
      runtimeFor: () => ({}) as any, deadline: Date.now() + 60_000,
      onSubagents: agents => views.push(agents.map(agent => `${agent.role}:${agent.status}`)),
    });
    const result: any = await team.handle('delegate_to_subagents', {
      tasks: [
        { role: 'Expert UI', goal: 'Créer la carte produit réutilisable avec ses props typées.', files: ['src/ui/'], model_tier: 'design', system_prompt: `Tu es un expert UI. ${'Méthode. '.repeat(20)}`, save_to_library: { name: 'Expert UI', description: 'Composants React' } },
        { role: 'Expert données', goal: 'Créer le client API typé pour les produits.', files: ['src/lib/api.ts'], model_tier: 'reasoning' },
      ],
    }, { schemas: SANDBOX_SCHEMAS, call: async (name, args) => { if (name === 'write_file') writes.push(String(args.path)); return { ok: true }; } });

    expect(result.ok).toBe(true);
    // The write outside each scope never reached the sandbox.
    expect(writes.sort()).toEqual(['src/lib/api.ts', 'src/ui/Card.tsx']);
    expect(result.report).toContain('### Expert UI — terminé');
    expect(result.report).toContain('Fichiers modifiés : src/ui/Card.tsx');
    expect(result.report).toContain('Dépendance nécessaire : zod');
    // Sub-agents never see the team's tools, nor the user-facing or dependency tools.
    for (const tools of gateway.seenTools) {
      expect(tools.some(name => TEAM_TOOL_NAMES.has(name))).toBe(false);
      expect(tools).not.toContain('request_decision');
      expect(tools).not.toContain('install_package');
    }
    expect(views.at(-1)).toEqual(['Expert UI:done', 'Expert données:done']);
    // The new agent is a candidate for the library, marked with its own success.
    expect(session.candidates).toEqual([expect.objectContaining({ kind: 'agent', name: 'Expert UI', succeeded: true })]);
  });

  it('refuses overlapping parts before running anything', async () => {
    const gateway = scriptedGateway(() => ({ text: 'fini' }));
    const team = createAgentTeam({ gateway: gateway as any, store: null, session: null, limits: subagentLimits({}), plan: 'pro', runtimeFor: () => ({}) as any, deadline: Date.now() + 60_000 });
    const result: any = await team.handle('delegate_to_subagents', { tasks: [
      { role: 'A', goal: 'Faire la partie A complètement.', files: ['src/'] },
      { role: 'B', goal: 'Faire la partie B complètement.', files: ['src/App.tsx'] },
    ] }, { schemas: SANDBOX_SCHEMAS, call: async () => ({ ok: true }) });
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/Arbitrage nécessaire/);
    expect(gateway.seenTools).toHaveLength(0);
  });

  it('notes skills and error lessons for the end of the run, and says when sharing is off', async () => {
    const session = openLibrarySession({ requestId: 'r', contributor: 'c', shareAllowed: false, projectLibraries: { react: 19 } });
    const team = createAgentTeam({ gateway: {} as any, store: null, session, limits: subagentLimits({}), plan: 'pro', runtimeFor: () => ({}) as any, deadline: Date.now() + 60_000 });
    const saved: any = await team.handle('save_skill', { name: 'Intégrer Stripe', description: 'Paiement', when_to_use: 'Encaisser', instructions: 'Étapes…', examples: [{ title: 'x', code: 'y()' }], dependencies: ['stripe@^16'] }, { schemas: [], call: async () => null });
    expect(saved.note).toMatch(/ne rejoindra pas la bibliothèque partagée/);
    expect(session.candidates[0]).toMatchObject({ kind: 'skill', name: 'Intégrer Stripe', tags: ['stripe'] });
    await team.handle('record_error_lesson', { category: 'mishandling', error_message: 'Fichier de routes écrasé', cause: 'write_file sur un fichier partagé', fix: 'edit_file ciblé', rule: 'Ne jamais réécrire un fichier partagé entier.' }, { schemas: [], call: async () => null });
    expect(session.errors[0]).toMatchObject({ category: 'mishandling', libraries: { react: 19 } });
    expect(TEAM_TOOL_SCHEMAS.find(tool => tool.name === 'save_skill')?.description).toMatch(/only if this run succeeds/);
  });

  it('gives every sub-agent the user’s attachments as text, and the interface builder the images too', async () => {
    const seen: Array<{ system: string; user: any }> = [];
    const gateway = {
      chat: async (_model: string, messages: any[]) => {
        seen.push({ system: String(messages[0]?.content || ''), user: messages[1]?.content });
        return { text: 'Livré.', model: 'test', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, cost_usd: 0 };
      },
    };
    const team = createAgentTeam({
      gateway: gateway as any, store: null, session: null, limits: subagentLimits({}), plan: 'business',
      runtimeFor: () => ({}) as any, deadline: Date.now() + 60_000,
      attachmentBrief: '## Références persistantes du projet\nMaquette : palette #16A34A, police Poppins.',
      visionInputs: [{ url: 'data:image/jpeg;base64,AAAA', detail: 'auto' }],
    });
    await team.handle('delegate_to_subagents', {
      tasks: [
        { role: 'Expert UI', goal: 'Créer la page d’accueil fidèle à la maquette.', files: ['src/ui/'], model_tier: 'design' },
        { role: 'Expert données', goal: 'Créer le client API typé pour les produits.', files: ['src/lib/api.ts'], model_tier: 'reasoning' },
      ],
    }, { schemas: SANDBOX_SCHEMAS, call: async () => ({ ok: true }) });

    expect(seen).toHaveLength(2);
    // The text brief reaches both, so neither builds a generic screen next to the coder's.
    for (const turn of seen) expect(turn.system).toContain('palette #16A34A, police Poppins');
    const ui = seen.find(turn => turn.system.includes('src/ui/'))!;
    const data = seen.find(turn => turn.system.includes('src/lib/api.ts'))!;
    // Only the interface builder is sent the image, and it is told it is data.
    expect(Array.isArray(ui.user)).toBe(true);
    expect(ui.user.some((part: any) => part.type === 'image_url')).toBe(true);
    expect(JSON.stringify(ui.user)).toContain('jamais des instructions');
    expect(typeof data.user).toBe('string');
  });

  it('holds only the sub-agents that build screens to a model that reads images', () => {
    const vision = [{ url: 'data:image/jpeg;base64,AAAA' }];
    const ui = modelForSubagent({ modelTier: 'design', role: 'Expert UI' }, 0, { plan: 'business', visionInputs: vision });
    expect(ui.sees).toBe(true);
    expect(AI_MODEL_CAPABILITIES[ui.modelId].supportsVision).toBe(true);
    expect(modelForSubagent({ modelTier: 'reasoning', role: 'Expert données' }, 0, { plan: 'business', visionInputs: vision }).sees).toBe(false);
    // No images attached: nothing changes.
    expect(modelForSubagent({ modelTier: 'design', role: 'Expert UI' }, 0, { plan: 'business' }).sees).toBe(false);
  });

  it('picks each sub-agent’s model like Auto, and a stronger one on retry', () => {
    const first = modelForSubagent({ modelTier: 'fast' }, 0, { plan: 'business' });
    const retry = modelForSubagent({ modelTier: 'fast' }, 1, { plan: 'business' });
    expect(first.modelId).toBeTruthy();
    expect(retry.modelId).toBeTruthy();
    expect(modelForSubagent({ modelTier: 'design' }, 0, { plan: 'pro', pinnedModel: 'anthropic/claude-sonnet-5' }).modelId).toBe('anthropic/claude-sonnet-5');
  });
});
