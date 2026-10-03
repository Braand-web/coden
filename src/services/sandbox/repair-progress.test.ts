import { describe, expect, it, vi } from 'vitest';
import { runCoderLoop } from './repair-loop';
import { validateProject, validateBuild, type ValidationReport } from './validate';

vi.mock('./sandbox-tools.ts', () => ({ SANDBOX_TOOL_SCHEMAS: [], createSandboxTools: () => ({ call: vi.fn() }) }));
vi.mock('./validate.ts', () => ({ validateProject: vi.fn(), validateBuild: vi.fn(), buildRepairInstruction: () => 'Repair these actual errors.' }));
const report = (errors: number): ValidationReport => ({ ok: errors === 0, durationMs: 1,
  ran: { devServer: true, typecheck: true, build: false },
  problems: Array.from({ length: errors }, (_, i) => ({ source: 'runtime', severity: 'error', message: `Failure ${i}` })),
});
const sandbox = { projectId: 'test', status: () => ({ state: 'running' }) } as any;

describe('repair progress and verification ordering', () => {
  it('stops oscillating 3→4→3→4 errors without mistaking regression recovery for progress', async () => {
    const sequence = [4, 3, 4, 3, 4, 3];
    vi.mocked(validateProject).mockImplementation(async () => report(sequence.shift() ?? 3));
    const turn = vi.fn(async () => ({ toolCalls: 0 }));
    const result = await runCoderLoop({ sandbox, turn, initialReport: report(3), maxRounds: 12, maxStalledRounds: 3 });
    expect(result.stoppedBecause).toBe('no_progress');
    expect(turn).toHaveBeenCalledTimes(3);
  });
  it('allows real progress and exits immediately on a verified result', async () => {
    const sequence = [4, 2, 1, 0];
    vi.mocked(validateProject).mockImplementation(async () => report(sequence.shift()!));
    vi.mocked(validateBuild).mockResolvedValue({ ok: true, ran: true, problems: [], durationMs: 1 });
    const turn = vi.fn(async () => ({ toolCalls: 0 }));
    const result = await runCoderLoop({ sandbox, turn, initialReport: report(3), maxRounds: 8, maxStalledRounds: 3 });
    expect(result.ok).toBe(true);
    expect(turn).toHaveBeenCalledTimes(4);
  });
  it('validates restored files, never mutates after the verification', async () => {
    const order: string[] = [];
    vi.mocked(validateProject).mockImplementation(async () => { order.push('typecheck'); return report(0); });
    vi.mocked(validateBuild).mockImplementation(async () => { order.push('build'); return { ok: true, ran: true, problems: [], durationMs: 1 }; });
    const result = await runCoderLoop({ sandbox, initialReport: report(1), turn: async () => { order.push('edit'); return { toolCalls: 0 }; },
      beforeValidation: async () => { order.push('restore'); }, verifyPreview: async () => { order.push('browser'); return report(0); },
      afterRound: async () => { order.push('snapshot'); } });
    expect(result.ok).toBe(true);
    expect(order).toEqual(['edit', 'restore', 'typecheck', 'browser', 'build', 'snapshot']);
  });
});
