// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { dismissGuide, firstBuildPending, FIRST_BUILD_EXPECTATION, FIRST_STEPS, FIRST_SUCCESS_TEXT, FIRST_TIPS, guideDismissed, markFirstBuildDone } from './first-run';

beforeEach(() => window.localStorage.clear());

describe('first-run state', () => {
  it('starts pending, and is done for good once the first build succeeded', () => {
    expect(firstBuildPending()).toBe(true);
    markFirstBuildDone();
    expect(firstBuildPending()).toBe(false);
  });

  it('remembers that the guide was dismissed', () => {
    expect(guideDismissed()).toBe(false);
    dismissGuide();
    expect(guideDismissed()).toBe(true);
  });

  it('survives blocked storage: nothing throws, the guide simply shows', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); }, configurable: true });
    try {
      expect(guideDismissed()).toBe(false);
      expect(() => dismissGuide()).not.toThrow();
      expect(firstBuildPending()).toBe(true);
      expect(() => markFirstBuildDone()).not.toThrow();
    } finally {
      Object.defineProperty(window, 'localStorage', real);
    }
  });
});

describe('what it says', () => {
  it('gives the time honestly and says the work goes on if the page is closed', () => {
    expect(FIRST_BUILD_EXPECTATION).toMatch(/2 à 4 minutes/);
    expect(FIRST_BUILD_EXPECTATION).toMatch(/fermer cette page, le travail continue/);
    expect(FIRST_STEPS[1].text).toMatch(/2 à 4 minutes/);
  });

  it('has three steps and a few tips, in the interface’s language', () => {
    expect(FIRST_STEPS).toHaveLength(3);
    expect(FIRST_TIPS.length).toBeGreaterThanOrEqual(3);
    expect(FIRST_SUCCESS_TEXT).toMatch(/première application est prête/);
  });
});

describe('where the builder uses it', () => {
  const builder = readFileSync('src/builder-live.ts', 'utf8');

  it('announces the wait only for a real build, once, never on a retry or a chat', () => {
    expect(builder).toMatch(/!isRecoveryRetry && !attach && promptUiContext === 'project_mission' && firstBuildPending\(\)\) appendMessage\('system', FIRST_BUILD_EXPECTATION\)/);
  });

  it('celebrates only a build that worked and showed something, and offers change / publish / share', () => {
    expect(builder).toMatch(/!hasNeedsFix && promptUiContext === 'project_mission' && \(liveUrl \|\| previewHtml\) && firstBuildPending\(\)\) showFirstSuccess\(\)/);
    const fn = builder.slice(builder.indexOf('function showFirstSuccess'), builder.indexOf('function bindProjectMenu'));
    expect(fn.indexOf('markFirstBuildDone()')).toBeLessThan(fn.indexOf('appendMessage('));
    for (const label of ["'Modifier'", "'Publier'", "'Partager par lien'"]) expect(fn).toContain(label);
  });
});
