import { describe, expect, it } from 'vitest';
import { buildReliabilityReport, evaluateReliabilityAlert, percentile, reliabilityAlertEnabled, type ReliabilityTurn } from './reliability-metrics';

const NOW = Date.parse('2026-09-30T20:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const turn = (status: string, agoMin: number, secs = 60, extra: Partial<ReliabilityTurn> = {}): ReliabilityTurn => ({
  status, created_at: minutesAgo(agoMin + secs / 60), started_at: minutesAgo(agoMin + secs / 60), completed_at: minutesAgo(agoMin), ...extra,
});

describe('the reliability report', () => {
  it('counts the success rate on finished turns only: cancelled, blocked and running stay out of it', () => {
    const report = buildReliabilityReport([turn('completed', 10), turn('completed', 20), turn('failed', 30), turn('cancelled', 40), turn('blocked', 50), turn('running', 5)], { now: NOW, days: 7 });
    expect(report.totals).toMatchObject({ turns: 6, completed: 2, failed: 1, cancelled: 1, other: 2 });
    expect(report.totals.successRate).toBeCloseTo(0.667, 3);
  });

  it('gives one row per day, empty days included, oldest first', () => {
    const report = buildReliabilityReport([turn('completed', 10), turn('failed', 60 * 24 * 2)], { now: NOW, days: 4 });
    expect(report.daily).toHaveLength(4);
    expect(report.daily.map(day => day.day)).toEqual([...report.daily.map(day => day.day)].sort());
    expect(report.daily.filter(day => day.turns === 0)).toHaveLength(2);
    expect(report.daily[report.daily.length - 1]).toMatchObject({ completed: 1, successRate: 1 });
  });

  it('has no rate for a day without a finished turn, rather than 0 %', () => {
    const report = buildReliabilityReport([turn('cancelled', 10)], { now: NOW, days: 2 });
    expect(report.totals.successRate).toBeNull();
    expect(report.daily.every(day => day.successRate === null)).toBe(true);
  });

  it('measures how long completed turns took, and groups by model and action', () => {
    const report = buildReliabilityReport([
      turn('completed', 10, 60, { checkpoint: { modelId: 'a/m1' }, resolved_action: 'build' }),
      turn('completed', 20, 120, { checkpoint: { modelId: 'a/m1' }, resolved_action: 'edit' }),
      turn('failed', 30, 30, { checkpoint: { modelId: 'b/m2' }, resolved_action: 'build' }),
    ], { now: NOW, days: 3 });
    expect(report.duration.p50Ms).toBe(60_000);
    expect(report.duration.p90Ms).toBe(120_000);
    expect(report.byModel[0]).toMatchObject({ key: 'a/m1', turns: 2, successRate: 1 });
    expect(report.byModel.find(row => row.key === 'b/m2')).toMatchObject({ failed: 1, successRate: 0 });
    expect(report.byAction.find(row => row.key === 'build')).toMatchObject({ turns: 2, completed: 1, failed: 1, successRate: 0.5 });
  });

  it('ignores turns outside the window and malformed dates', () => {
    const report = buildReliabilityReport([turn('completed', 60 * 24 * 30), { status: 'completed', created_at: 'n/a' }, turn('completed', 5)], { now: NOW, days: 7 });
    expect(report.totals.turns).toBe(1);
  });

  it('computes percentiles without inventing data', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 90)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });
});

describe('the reliability alert', () => {
  const many = (completed: number, failed: number) => [...Array.from({ length: completed }, (_, i) => turn('completed', 5 + i)), ...Array.from({ length: failed }, (_, i) => turn('failed', 5 + i))];

  it('warns when most recent turns failed and there are enough of them to mean something', () => {
    const alert = evaluateReliabilityAlert(many(3, 9), { now: NOW });
    expect(alert).toMatchObject({ level: 'warn', turns: 12, failed: 9 });
  });

  it('stays quiet on a quiet hour, on a good run, and on a few failures', () => {
    expect(evaluateReliabilityAlert(many(0, 3), { now: NOW }).level).toBe('ok');
    expect(evaluateReliabilityAlert(many(10, 2), { now: NOW }).level).toBe('ok');
    expect(evaluateReliabilityAlert([], { now: NOW }).level).toBe('ok');
  });

  it('only looks at turns that ended inside the window', () => {
    const old = Array.from({ length: 12 }, (_, i) => turn('failed', 600 + i));
    expect(evaluateReliabilityAlert([...old, ...many(5, 0)], { now: NOW }).level).toBe('ok');
  });

  it('can be switched off', () => {
    expect(reliabilityAlertEnabled({})).toBe(true);
    expect(reliabilityAlertEnabled({ CODEN_RELIABILITY_ALERT: '0' })).toBe(false);
  });
});

describe('activation: how many people who tried got a real result', () => {
  const build = (user: string, agoMin: number, secs: number, status = 'completed') => ({ ...turn(status, agoMin, secs), user_id: user });

  it('counts a result only when it is a build: a chat answer in seconds is not one', () => {
    const report = buildReliabilityReport([build('a', 100, 5), build('a', 90, 8), build('b', 80, 120), build('c', 70, 200), build('d', 60, 90, 'failed')], { now: NOW, days: 3 });
    expect(report.activation.people).toBe(4);
    expect(report.activation.withResult).toBe(2);
    expect(report.activation.rate).toBe(0.5);
  });

  it('measures each person’s first result against three minutes', () => {
    const report = buildReliabilityReport([build('b', 80, 120), build('c', 70, 200), build('e', 50, 90)], { now: NOW, days: 3 });
    expect(report.activation.underThreeMinutes).toBeCloseTo(0.667, 3);
    expect(report.activation.firstResultP50Ms).toBe(120_000);
  });

  it('takes the earliest build of a person, not their fastest', () => {
    const report = buildReliabilityReport([build('b', 200, 240), build('b', 50, 70)], { now: NOW, days: 3 });
    expect(report.activation.firstResultP50Ms).toBe(240_000);
    expect(report.activation.underThreeMinutes).toBe(0);
  });

  it('has no rate without anyone, and ignores turns with no user', () => {
    const empty = buildReliabilityReport([turn('completed', 10, 120)], { now: NOW, days: 3 });
    expect(empty.activation).toMatchObject({ people: 0, withResult: 0, rate: null, underThreeMinutes: null, firstResultP50Ms: null });
  });
});
