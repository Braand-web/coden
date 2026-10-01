import { describe, expect, it, vi } from 'vitest';
import { captureCandidates, captureRow, captureSince, captureTurnCosts, costCaptureEnabled, type CapturableTurn } from './turn-cost-capture.ts';

const now = new Date('2026-10-02T12:00:00Z');
const turn = (over: Partial<CapturableTurn> = {}): CapturableTurn => ({
  id: 'turn_1', thread_id: 'thr_1', status: 'failed', requested_mode: 'auto',
  budget_used: { costUsd: 0.14, toolCalls: 323, repairAttempts: 7, subagents: 2 },
  created_at: '2026-10-02T10:00:00Z', updated_at: '2026-10-02T10:20:00Z', ...over,
});
const since = '2026-10-01T12:00:00Z';

describe('which turns are captured', () => {
  it('keeps a finished turn that cost something and is not in the ledger', () => {
    const [candidate] = captureCandidates([turn()], new Set(), { since, now });
    expect(candidate).toMatchObject({ turnId: 'turn_1', status: 'failed', costUsd: 0.14, toolCalls: 323, repairAttempts: 7, subagents: 2 });
  });

  it('skips turns still running, too recent to be final, free, already captured or older than the watermark', () => {
    const turns = [
      turn({ id: 'running', status: 'running' }),
      turn({ id: 'recent', updated_at: '2026-10-02T11:55:00Z' }),
      turn({ id: 'free', budget_used: { costUsd: 0 } }),
      turn({ id: 'nothing', budget_used: null }),
      turn({ id: 'done' }),
      turn({ id: 'legacy', created_at: '2026-09-20T10:00:00Z' }),
    ];
    expect(captureCandidates(turns, new Set(['done']), { since, now })).toEqual([]);
  });

  it('captures cancelled and blocked turns as well', () => {
    const turns = [turn({ id: 'a', status: 'cancelled' }), turn({ id: 'b', status: 'blocked' }), turn({ id: 'c', status: 'completed' })];
    expect(captureCandidates(turns, new Set(), { since, now }).map(candidate => candidate.turnId)).toEqual(['a', 'b', 'c']);
  });
});

describe('the measurement row', () => {
  const candidate = captureCandidates([turn()], new Set(), { since, now })[0];

  it('moves no credit, carries the fee-inclusive cost and a key per turn', () => {
    const row = captureRow(candidate, 'acc_1', { fee: cost => cost * 1.055, priceVersion: 'v:capture' });
    expect(row).toMatchObject({ account_id: 'acc_1', category: 'build', resource: 'turn_failed', unit: 'turn', idempotency_key: 'turn:turn_1:cost-capture', price_version_id: 'v:capture' });
    expect(row.provider_cost_usd).toBeCloseTo(0.1477, 4);
    expect(row.complete_cost_usd).toBe(row.provider_cost_usd);
    expect(Object.keys(row)).not.toContain('v3_credits');
    expect(Object.keys(row)).not.toContain('cost_credits');
  });

  it('holds identity, outcome and counters only: no prompt, no personal data', () => {
    const row = captureRow(candidate, 'acc_1', { fee: cost => cost, priceVersion: 'v' });
    expect(Object.keys(row.provider_payload).sort()).toEqual(['captured_by', 'mode', 'outcome', 'repair_attempts', 'source', 'subagents', 'tool_calls', 'turn_id']);
  });
});

describe('one capture pass', () => {
  const table = (rows: unknown[]) => {
    const builder: any = { select: () => builder, in: () => builder, gte: () => builder, order: () => builder, limit: () => Promise.resolve({ data: rows, error: null }) };
    return builder;
  };
  const clientFor = (tables: Record<string, unknown[]>) => ({
    from: (name: string) => {
      const rows = tables[name] || [];
      const builder: any = { select: () => builder, in: () => (name === 'agent_turns' ? builder : Promise.resolve({ data: rows, error: null })), gte: () => builder, order: () => builder, limit: () => Promise.resolve({ data: rows, error: null }) };
      return builder;
    },
  });

  it('writes the missing rows, skips a turn whose pipeline already wrote its row, and is repeatable', async () => {
    const insert = vi.fn(async () => 'event');
    const client = clientFor({
      agent_turns: [turn({ id: 'new' }), turn({ id: 'seen' }), turn({ id: 'orphan', thread_id: 'thr_x' })],
      usage_events: [{ provider_payload: { turn_id: 'seen' } }],
      agent_threads: [{ id: 'thr_1', organization_id: 'org_1' }],
    });
    const report = await captureTurnCosts(client, { insert, fee: cost => cost, priceVersion: 'v', since, now });
    expect(report).toMatchObject({ scanned: 3, candidates: 2, captured: 1, skippedNoAccount: 1, failed: 0, usd: 0.14 });
    expect(insert).toHaveBeenCalledTimes(1);
    expect((insert.mock.calls[0] as any)[0]).toMatchObject({ account_id: 'org_1', idempotency_key: 'turn:new:cost-capture' });
  });

  it('counts a failed insert without stopping the pass', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const insert = vi.fn(async () => { throw new Error('boom'); });
    const client = clientFor({ agent_turns: [turn()], usage_events: [], agent_threads: [{ id: 'thr_1', organization_id: 'org_1' }] });
    const report = await captureTurnCosts(client, { insert, fee: cost => cost, priceVersion: 'v', since, now });
    expect(report).toMatchObject({ captured: 0, failed: 1 });
  });
});

describe('the switches', () => {
  it('is on unless CODEN_COST_CAPTURE=0, and honours a valid watermark override', () => {
    expect(costCaptureEnabled({})).toBe(true);
    expect(costCaptureEnabled({ CODEN_COST_CAPTURE: '0' })).toBe(false);
    expect(captureSince({})).toBe('2026-10-01T12:00:00Z');
    expect(captureSince({ CODEN_COST_CAPTURE_SINCE: '2026-11-01T00:00:00Z' })).toBe('2026-11-01T00:00:00.000Z');
    expect(captureSince({ CODEN_COST_CAPTURE_SINCE: 'not a date' })).toBe('2026-10-01T12:00:00Z');
  });
});
