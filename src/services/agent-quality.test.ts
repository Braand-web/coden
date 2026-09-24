import { describe, expect, it } from 'vitest';
import { normalizeAcceptanceScenarios } from './sandbox/acceptance';
import { resolveQualityPolicy } from './quality-tier';
import { buildProjectTheme, renderThemeCss, renderThemeIndexHtml } from './sandbox/design-theme';
import { STARTERS, describeStarter, selectStarter, themeStarter } from './sandbox/starters';
import { STARTER_KIT_FILES } from './sandbox/starter-kit';
import { renderPolishInstruction, runDesignReview } from './design-review-agent';

describe('acceptance scenarios', () => {
  it('keeps executable steps and drops malformed ones', () => {
    const scenarios = normalizeAcceptanceScenarios([
      { name: 'Add a task', steps: [
        { action: 'click', target: 'Add' },
        { action: 'fill', target: 'Title', value: 'Bake bread' },
        { action: 'teleport', target: 'Mars' },
        { action: 'navigate', path: 'javascript:alert(1)' },
        { action: 'expect_text', text: 'Bake bread' },
      ] },
      { name: 'No assertion', steps: [{ action: 'click', target: 'Add' }] },
      'nonsense',
    ]);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].steps.map(step => step.action)).toEqual(['click', 'fill', 'expect_text']);
  });

  it('caps the number of scenarios and steps', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ name: `s${index}`, steps: Array.from({ length: 30 }, () => ({ action: 'expect_text', text: 'x' })) }));
    const scenarios = normalizeAcceptanceScenarios(many);
    expect(scenarios).toHaveLength(5);
    expect(scenarios[0].steps.length).toBeLessThanOrEqual(12);
  });
});

describe('quality policy follows the budget', () => {
  it('spends nothing extra for a user with almost no credits', () => {
    const policy = resolveQualityPolicy({ route: 'new_project', credits: 2, effort: 'Medium', plan: 'free' });
    expect(policy.tier).toBe('lean');
    expect(policy.specialists).toBe(false);
    expect(policy.designReview).toBe(false);
    // Journeys and exploration cost no model calls, so even a lean run keeps them.
    expect(policy.acceptance).toBe(true);
    expect(policy.explore).toBe(true);
  });

  it('gives a new project the design review at standard level', () => {
    const policy = resolveQualityPolicy({ route: 'new_project', credits: 30, effort: 'Medium', plan: 'pro' });
    expect(policy.tier).toBe('standard');
    expect(policy.designReview).toBe(true);
    // Straight to the plan: no specialist pre-analysis at the default level.
    expect(policy.specialists).toBe(false);
  });

  it('does not make every enterprise run premium: the chosen level decides', () => {
    expect(resolveQualityPolicy({ route: 'new_project', credits: 1_000_000, effort: 'Medium', plan: 'enterprise' }).tier).toBe('standard');
    expect(resolveQualityPolicy({ route: 'new_project', credits: 1_000_000, effort: 'High', plan: 'enterprise' }).tier).toBe('premium');
  });

  it('gives the full treatment to high effort with a real balance', () => {
    const policy = resolveQualityPolicy({ route: 'large_change', credits: 500, effort: 'Ultra', plan: 'pro' });
    expect(policy.tier).toBe('premium');
    expect(policy.designReview).toBe(true);
    expect(policy.maxSpecialists).toBe(5);
  });

  it('keeps small edits fast whatever the budget', () => {
    const policy = resolveQualityPolicy({ route: 'small_edit', credits: 500, effort: 'Ultra', plan: 'enterprise' });
    expect(policy).toMatchObject({ specialists: false, acceptance: false, explore: false, designReview: false });
  });
});

describe('per-project visual identity', () => {
  it('differs across projects and stays stable for one project', () => {
    const prompt = 'Un tableau de bord pour suivre les ventes';
    const a1 = buildProjectTheme({ prompt, seed: 'project-a' });
    const a2 = buildProjectTheme({ prompt, seed: 'project-a' });
    expect(a2).toEqual(a1);
    const hues = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(seed => buildProjectTheme({ prompt, seed }).hue));
    expect(hues.size).toBeGreaterThan(1);
  });

  it('follows the words the user used about the look', () => {
    expect(buildProjectTheme({ prompt: 'a portfolio with a dark look', seed: 'x' }).mode).toBe('dark');
    expect(buildProjectTheme({ prompt: 'un site de restaurant clair et lumineux', seed: 'x' }).mode).toBe('light');
  });

  it('writes complete tokens for both modes and loads its fonts', () => {
    const theme = buildProjectTheme({ prompt: 'a bakery website', seed: 'bakery-1' });
    const css = renderThemeCss(theme);
    for (const token of ['--color-bg', '--color-accent', '--color-accent-soft', '--font-body', '--font-display', '--radius-card', '--duration-state']) expect(css).toContain(token);
    expect(css).toContain(':root[data-theme="light"]');
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain('prefers-reduced-motion');
    const html = renderThemeIndexHtml(theme, 'Fournil <script>');
    expect(html).toContain('<title>Fournil script</title>');
    if (theme.body) expect(html).toContain('fonts.googleapis.com/css2?family=');
  });
});

describe('starter kit', () => {
  it('ships the kit and the interface libraries in every scaffold', () => {
    for (const starter of Object.values(STARTERS)) {
      const pkg = JSON.parse(starter.files.find(file => file.path === 'package.json')!.content);
      expect(pkg.dependencies).toMatchObject({ 'lucide-react': expect.any(String), motion: expect.any(String), 'react-router-dom': expect.any(String) });
      for (const file of STARTER_KIT_FILES) expect(starter.files.some(candidate => candidate.path === file.path)).toBe(true);
    }
  });

  it('pins every dependency', () => {
    const pkg = JSON.parse(STARTERS['react-vite'].files.find(file => file.path === 'package.json')!.content);
    for (const version of [...Object.values(pkg.dependencies), ...Object.values(pkg.devDependencies)] as string[]) expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('themes the scaffold for the project and describes it to the model', () => {
    const starter = themeStarter(selectStarter('a booking app for a spa'), { prompt: 'a booking app for a spa', seed: 'spa-1', title: 'Spa' });
    const css = starter.files.find(file => file.path === 'src/index.css')!.content;
    expect(css).toContain('--font-body');
    const description = describeStarter(starter);
    expect(description).toContain('@/components/ui/Button');
    expect(description).toContain('Visual identity already applied');
  });
});

describe('design review', () => {
  it('turns findings into a polish instruction that freezes behaviour', () => {
    const text = renderPolishInstruction({ score: 6, issues: [{ area: 'hero', problem: 'The primary action is lost', fix: 'Make "Commander" a primary Button above the fold' }] }, ['Touch targets under 32px on mobile: Menu'], true);
    expect(text).toMatch(/^DESIGN_REVIEW/);
    expect(text).toContain('keep every feature, route, label');
    expect(text).toContain('Touch targets');
    expect(text).toContain('French');
  });

  const shot = [{ width: 1280, dataUrl: 'data:image/jpeg;base64,AAAA' }];
  const gateway = (text: string) => ({ chat: async () => ({ text, model: 'x', cost_usd: 0.002, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) }) as any;

  it('asks for a polish round below the bar', async () => {
    const outcome = await runDesignReview({ gateway: gateway('{"score":5,"issues":[{"area":"cards","problem":"Wall of equal boxes","fix":"Vary card sizes"}]}'), prompt: 'shop', screenshots: shot, plan: 'pro', credits: 100 });
    expect(outcome.instruction).toContain('Wall of equal boxes');
    expect(outcome.costUsd).toBeGreaterThan(0);
  });

  it('lets a good result through and never blocks on a bad answer', async () => {
    expect((await runDesignReview({ gateway: gateway('{"score":9,"issues":[]}'), prompt: 'shop', screenshots: shot, plan: 'pro', credits: 100 })).instruction).toBeUndefined();
    expect((await runDesignReview({ gateway: gateway('not json at all'), prompt: 'shop', screenshots: shot, plan: 'pro', credits: 100 })).instruction).toBeUndefined();
    const failing = { chat: async () => { throw new Error('provider down'); } } as any;
    expect((await runDesignReview({ gateway: failing, prompt: 'shop', screenshots: shot, plan: 'pro', credits: 100 })).instruction).toBeUndefined();
    expect((await runDesignReview({ gateway: failing, prompt: 'shop', screenshots: [], plan: 'pro' })).review).toBeNull();
  });
});
