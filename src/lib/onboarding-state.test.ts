import { describe, expect, it } from 'vitest';
import { ONBOARDING_STEPS, recommendPlan, sanitizeAnswers, shouldShowOnboarding } from './onboarding-state';

const now = Date.parse('2026-09-24T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

describe('shouldShowOnboarding', () => {
  it('opens for a new account that has not answered', () => {
    expect(shouldShowOnboarding({ createdAt: hoursAgo(1), now })).toBe(true);
  });

  it('stays closed once finished or skipped, here or on another device', () => {
    expect(shouldShowOnboarding({ createdAt: hoursAgo(1), record: { completed_at: hoursAgo(0) }, now })).toBe(false);
    expect(shouldShowOnboarding({ createdAt: hoursAgo(1), record: { skipped: true }, now })).toBe(false);
    expect(shouldShowOnboarding({ createdAt: hoursAgo(1), locallyDone: true, now })).toBe(false);
  });

  it('never shows to existing accounts', () => {
    expect(shouldShowOnboarding({ createdAt: hoursAgo(24 * 30), now })).toBe(false);
    expect(shouldShowOnboarding({ createdAt: null, now })).toBe(false);
  });

  it('waits when someone arrived with a prompt to build', () => {
    expect(shouldShowOnboarding({ createdAt: hoursAgo(1), pendingPrompt: true, now })).toBe(false);
  });
});

describe('recommendPlan', () => {
  it('recommends Business for teams and agencies, Pro otherwise', () => {
    expect(recommendPlan({ usage: 'team' })).toBe('business');
    expect(recommendPlan({ profile: 'agency', usage: 'personal' })).toBe('business');
    expect(recommendPlan({ profile: 'founder', usage: 'personal' })).toBe('pro');
    expect(recommendPlan({})).toBe('pro');
  });
});

describe('sanitizeAnswers', () => {
  it('keeps only values the steps offer', () => {
    expect(sanitizeAnswers({ profile: 'founder', goal: '<script>', usage: 'team' })).toEqual({ profile: 'founder', usage: 'team' });
  });

  it('asks four questions', () => {
    expect(ONBOARDING_STEPS.map(step => step.key)).toEqual(['profile', 'goal', 'project', 'usage']);
  });
});
