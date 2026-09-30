import { describe, expect, it } from 'vitest';
import { findCompletedTurnForRun } from './run-ledger';

const at = (seconds: number) => new Date(Date.parse('2026-09-30T18:00:00Z') + seconds * 1000).toISOString();
const run = { id: 'run_1', project_id: 'p1', created_at: at(8) };
const turn = (id: string, seconds: number, extra: Record<string, unknown> = {}) => ({ id, project_id: 'p1', status: 'completed', created_at: at(seconds), ...extra });

describe('a run left open beside a turn that finished', () => {
  it('is matched to the completed turn of the same project that started just before it', () => {
    expect(findCompletedTurnForRun(run, [turn('t1', 0)])?.id).toBe('t1');
  });

  it('takes the nearest turn when there are several', () => {
    expect(findCompletedTurnForRun(run, [turn('far', -60), turn('near', 5)])?.id).toBe('near');
  });

  it('never matches a failed, cancelled or running turn: those are what the reaper is for', () => {
    for (const status of ['failed', 'cancelled', 'running', 'blocked']) expect(findCompletedTurnForRun(run, [turn('t', 0, { status })])).toBeNull();
  });

  it('never matches another project, nor a turn from long before or from after', () => {
    expect(findCompletedTurnForRun(run, [turn('t', 0, { project_id: 'other' })])).toBeNull();
    expect(findCompletedTurnForRun(run, [turn('old', -600)])).toBeNull();
    expect(findCompletedTurnForRun(run, [turn('next', 120)])).toBeNull();
  });

  it('does not guess from a date it cannot read', () => {
    expect(findCompletedTurnForRun({ ...run, created_at: 'n/a' }, [turn('t', 0)])).toBeNull();
  });
});

describe('where the reaper uses it', () => {
  it('settles matched runs before it stamps the rest as interrupted', async () => {
    const { readFileSync } = await import('node:fs');
    const server = readFileSync('server.ts', 'utf8');
    const reaper = server.slice(server.indexOf('async function reapInterruptedAgentRuns'), server.indexOf("console.log('[coden:interrupted_runs_reaped]'"));
    expect(reaper.indexOf('findCompletedTurnForRun(run, turnsOfProjects)')).toBeGreaterThan(-1);
    expect(reaper.indexOf('findCompletedTurnForRun')).toBeLessThan(reaper.indexOf("diagnostic_code: 'RUN_INTERRUPTED'"));
    // Only completed turns can settle a run; everything else is still reaped.
    expect(reaper).toMatch(/\.eq\('status', 'completed'\)/);
  });
});
