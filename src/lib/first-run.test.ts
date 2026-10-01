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
    expect(builder).toMatch(/!isRecoveryRetry && !attach && promptUiContext === 'project_mission' && firstBuildPending\(\)\) \{\n    appendMessage\('system', FIRST_BUILD_EXPECTATION\);/);
  });

  it('celebrates only a build that worked and showed something, and offers change / publish / share', () => {
    expect(builder).toMatch(/!hasNeedsFix && promptUiContext === 'project_mission' && \(liveUrl \|\| previewHtml\) && firstBuildPending\(\)\) showFirstSuccess\(\)/);
    const fn = builder.slice(builder.indexOf('function showFirstSuccess'), builder.indexOf('function bindProjectMenu'));
    expect(fn.indexOf('markFirstBuildDone()')).toBeLessThan(fn.indexOf('appendMessage('));
    for (const label of ["'Modifier'", "'Publier'", "'Partager par lien'"]) expect(fn).toContain(label);
  });
});

describe('help for a first build that is slow or fails', () => {
  it('asks for a deliberately simple first version, once, in the language of the request', async () => {
    const { simplerRetryPrompt } = await import('./first-run');
    const fr = simplerRetryPrompt('Crée un CRM complet', true);
    expect(fr.startsWith('Crée un CRM complet')).toBe(true);
    expect(fr).toMatch(/volontairement simple/);
    expect(simplerRetryPrompt(fr, true)).toBe(fr);
    expect(simplerRetryPrompt('Build a CRM', false)).toMatch(/deliberately simple/);
  });

  it('tells a slow build — after four minutes, past the median of two — that the work goes on', async () => {
    const { FIRST_BUILD_SLOW, FIRST_BUILD_SLOW_MS } = await import('./first-run');
    expect(FIRST_BUILD_SLOW_MS).toBe(240_000);
    expect(FIRST_BUILD_SLOW).toMatch(/Le travail continue/);
  });

  it('is wired once per first build: a timer cleared when the run ends, and a simple retry that never loops', () => {
    const builder = readFileSync('src/builder-live.ts', 'utf8');
    expect(builder).toMatch(/slowFirstBuildTimer = window\.setTimeout\(\(\) => \{ if \(isGenerating\) appendMessage\('system', FIRST_BUILD_SLOW\); \}, FIRST_BUILD_SLOW_MS\)/);
    expect(builder).toMatch(/if \(slowFirstBuildTimer !== null\) window\.clearTimeout\(slowFirstBuildTimer\)/);
    expect(builder).toMatch(/promptUiContext === 'project_mission' && firstBuildPending\(\) && !isRecoveryRetry\) \{\n        const help = appendMessage\('system', FIRST_BUILD_FAILED\)/);
    expect(builder).toMatch(/addInlineAction\(help, 'Réessayer en version simple'/);
  });
});
