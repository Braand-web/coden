import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hueDistance, MIN_DISTANCE, pickDistinctHue, readDesignIdentity } from './design-diversity';
import { buildProjectTheme } from './design-theme';

describe('hue distance', () => {
  it('is the short way round the wheel', () => {
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
    expect(hueDistance(250, 250)).toBe(0);
    expect(hueDistance(-10, 10)).toBe(20);
  });
});

describe('picking a hue away from the recent ones', () => {
  const pool = [250, 220, 175, 265];

  it('is the seed’s own choice when there is no history', () => {
    expect(pickDistinctHue(pool, 0)).toBe(250);
    expect(pickDistinctHue(pool, 5)).toBe(220);
  });

  it('keeps away from the recent hues when the pool allows it', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const hue = pickDistinctHue(pool, seed, [250]);
      expect(hueDistance(hue, 250)).toBeGreaterThanOrEqual(MIN_DISTANCE);
    }
  });

  it('takes the farthest one when nothing is far enough, never the recent hue itself', () => {
    // Newest first: 250 was the last one, so the pick is far from 250 even though 220 and 175 also ruled themselves out.
    const hue = pickDistinctHue(pool, 3, [250, 220, 175]);
    expect(hueDistance(hue, 250)).toBeGreaterThanOrEqual(MIN_DISTANCE);
    expect(pickDistinctHue([250, 255], 0, [250])).toBe(255);
    expect(pickDistinctHue([250], 0, [250])).toBe(250); // a pool of one has no choice
  });

  it('is stable for a given history, and a stored hue always wins', () => {
    expect(pickDistinctHue(pool, 7, [250])).toBe(pickDistinctHue(pool, 7, [250]));
    expect(pickDistinctHue(pool, 7, [250, 220], 175)).toBe(175);
    expect(pickDistinctHue(pool, 7, [250], 0)).toBe(0);
  });
});

describe('a person’s successive projects', () => {
  const prompt = 'Un tableau de bord de suivi des ventes avec graphiques et tableaux';

  it('rarely repeat the look of the one before', () => {
    const history: number[] = [];
    let repeats = 0;
    for (let index = 0; index < 40; index += 1) {
      const theme = buildProjectTheme({ prompt, seed: `project-${index}`, avoidHues: history.slice(0, 6) });
      if (history.length && theme.hue === history[0]) repeats += 1;
      history.unshift(theme.hue);
    }
    expect(repeats).toBe(0);
  });

  it('without the fix, the same seeds do repeat (the problem being solved)', () => {
    let repeats = 0;
    let previous = -1;
    for (let index = 0; index < 40; index += 1) {
      const theme = buildProjectTheme({ prompt, seed: `project-${index}` });
      if (theme.hue === previous) repeats += 1;
      previous = theme.hue;
    }
    expect(repeats).toBeGreaterThan(0);
  });

  it('a project keeps its own hue once chosen, whatever the history says later', () => {
    const first = buildProjectTheme({ prompt, seed: 'p-1', avoidHues: [] });
    const later = buildProjectTheme({ prompt, seed: 'p-1', avoidHues: [first.hue], lockHue: first.hue });
    expect(later.hue).toBe(first.hue);
  });
});

describe('a stored identity', () => {
  it('is read only when it is a real one', () => {
    expect(readDesignIdentity({ hue: 250, direction: 'data_operational', mode: 'dark' })).toEqual({ hue: 250, direction: 'data_operational', mode: 'dark' });
    expect(readDesignIdentity({ hue: 'red' })).toBeNull();
    expect(readDesignIdentity({ hue: 500 })).toBeNull();
    expect(readDesignIdentity(null)).toBeNull();
    expect(readDesignIdentity('x')).toBeNull();
  });
});

describe('the wiring', () => {
  const server = readFileSync('server.ts', 'utf8');
  const pipeline = readFileSync('src/services/multi-agent-pipeline.ts', 'utf8');
  const migration = readFileSync('supabase/migrations/20260930230000_project_design_identity.sql', 'utf8');

  it('only a new project is given a history, and remembering the look never fails a run', () => {
    expect(server).toMatch(/designHistory: pipelineRoute === 'new_project' \? await loadDesignHistory\(userId, project\.id\) : undefined/);
    expect(pipeline).toMatch(/try \{ input\.onDesignIdentity\?\.\(starter\.theme\); \} catch/);
  });

  it('the migration is additive and nullable', () => {
    expect(migration).toMatch(/add column if not exists design_identity jsonb;/);
    expect(migration).not.toMatch(/drop |not null|delete /i);
  });
});
