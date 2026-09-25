import { describe, expect, it } from 'vitest';
import { parseDelegation, pathInScope, renderDelegationReport, runSubagents, scopeConflicts, subagentLimits, type SubagentOutcome, type SubagentTask } from './subagents';

const limits = subagentLimits({});
const task = (role: string, files: string[], extra: Record<string, unknown> = {}) => ({ role, goal: `Livrer la partie ${role} complètement, avec ses types.`, files, ...extra });
const outcome = (patch: Partial<SubagentOutcome> = {}): SubagentOutcome => ({ ok: true, summary: 'fait', filesChanged: [], toolCalls: 3, tokens: 1_000, costUsd: 0.01, stoppedBecause: 'answered', model: 'Luna', ...patch });

describe('sub-agents', () => {
  it('reads its limits from the environment, with safe bounds', () => {
    expect(limits).toMatchObject({ maxParallel: 5, maxTasks: 10, tokenBudget: 400_000, timeoutMs: 360_000 });
    expect(subagentLimits({ CODEN_SUBAGENTS_MAX_PARALLEL: '50', CODEN_SUBAGENT_TOKEN_BUDGET: '10' })).toMatchObject({ maxParallel: 8, tokenBudget: 20_000 });
  });

  it('keeps each sub-agent inside its own files', () => {
    expect(pathInScope('src/components/Card.tsx', ['src/components/'])).toBe(true);
    expect(pathInScope('./src/components/Card.tsx', ['src/components/'])).toBe(true);
    expect(pathInScope('src/lib/api.ts', ['src/components/'])).toBe(false);
    expect(pathInScope('src/components/../lib/api.ts', ['src/components/'])).toBe(false);
    expect(pathInScope('src/App.tsx', ['src/App.tsx'])).toBe(true);
  });

  it('asks the master to arbitrate when two parts share a file', () => {
    const parsed = parseDelegation({ tasks: [task('Expert UI', ['src/components/', 'src/App.tsx']), task('Expert données', ['src/lib/', 'src/App.tsx'])] }, limits, () => false);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toMatch(/Arbitrage nécessaire : « Expert UI » et « Expert données » touchent tous deux src\/App\.tsx/);
    expect(scopeConflicts([{ id: 'a', role: 'A', scope: ['src/'] }, { id: 'b', role: 'B', scope: ['src/lib/x.ts'] }])).toHaveLength(1);
  });

  it('refuses package.json, too many parts, vague parts and unknown library agents', () => {
    expect(parseDelegation({ tasks: [task('Deps', ['package.json'])] }, limits, () => false)).toMatchObject({ ok: false });
    expect(parseDelegation({ tasks: Array.from({ length: 11 }, (_, index) => task(`R${index}`, [`src/${index}/`])) }, limits, () => false)).toMatchObject({ ok: false });
    expect(parseDelegation({ tasks: [{ role: 'UI', goal: 'court', files: ['src/'] }] }, limits, () => false)).toMatchObject({ ok: false });
    expect(parseDelegation({ tasks: [task('UI', ['src/ui/'], { library_agent_id: 'nope' })] }, limits, () => false)).toMatchObject({ ok: false });
    const ok = parseDelegation({ tasks: [task('UI', ['src/ui/'], { model_tier: 'design', tools: ['run_command', 'restart_server', 'request_decision'] }), task('Tests', ['tests/'])] }, limits, () => false);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.tasks[0].modelTier).toBe('design');
      // Only allowed tools; the user-facing ones stay with the master.
      expect(ok.tasks[0].tools).toContain('run_command');
      expect(ok.tasks[0].tools).not.toContain('request_decision');
      expect(ok.tasks[0].tools).not.toContain('restart_server');
      expect(ok.tasks[0].tools).not.toContain('delegate_to_subagents');
    }
  });

  it('runs at most N at once and retries a failure once, on a stronger model', async () => {
    const tasks: SubagentTask[] = Array.from({ length: 7 }, (_, index) => ({ id: `sub-${index}`, role: `R${index}`, goal: 'g', scope: [`src/${index}/`], tools: [], modelTier: 'balanced' }));
    let running = 0;
    let peak = 0;
    const attempts: Array<[string, number]> = [];
    const snapshots: string[][] = [];
    const results = await runSubagents({
      tasks,
      limits: { ...limits, maxParallel: 3 },
      execute: async (current, attempt, report) => {
        attempts.push([current.id, attempt]);
        running += 1;
        peak = Math.max(peak, running);
        report({ progress: 0.5, model: attempt ? 'Opus' : 'Luna' });
        await new Promise(resolve => setTimeout(resolve, 10));
        running -= 1;
        if (current.id === 'sub-2' && attempt === 0) return outcome({ ok: false, error: 'budget de tokens épuisé' });
        if (current.id === 'sub-4') throw new Error('provider down');
        return outcome({ filesChanged: [`src/${current.id}.ts`] });
      },
      onUpdate: views => snapshots.push(views.map(view => view.status)),
    });
    expect(peak).toBe(3);
    expect(attempts.filter(([id]) => id === 'sub-2')).toEqual([['sub-2', 0], ['sub-2', 1]]);
    expect(results.find(result => result.task.id === 'sub-2')).toMatchObject({ attempts: 2, outcome: { ok: true } });
    expect(results.find(result => result.task.id === 'sub-4')).toMatchObject({ attempts: 2, outcome: { ok: false, error: 'provider down' } });
    expect(snapshots.some(statuses => statuses.includes('retrying'))).toBe(true);
    expect(snapshots.at(-1)?.filter(status => status === 'failed')).toHaveLength(1);
    const report = renderDelegationReport(results);
    expect(report).toContain('### R2 — terminé (relancé sur un modèle plus puissant)');
    expect(report).toContain('### R4 — échec');
    expect(report).toContain('c’est toi qui lui rends compte');
  });
});
