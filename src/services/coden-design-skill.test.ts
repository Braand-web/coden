import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CODEN_DESIGN_DIGEST, CODEN_DESIGN_GRID, CODEN_DESIGN_MINIMAL, CODEN_DESIGN_PASS_SCORE, codenDesignEnabled, designReviewRubric, designSkillBlock } from './coden-design-skill';
import { designReviewPassScore, runDesignReview } from './design-review-agent';

describe('the coden-design skill is kept as given, and handed to the agents in the right size', () => {
  const skill = readFileSync('skills/coden-design/SKILL.md', 'utf8');

  it('is in the repository with its frontmatter and its sixteen sections', () => {
    expect(skill).toMatch(/^---\nname: coden-design\n/);
    for (let n = 1; n <= 16; n += 1) expect(skill).toMatch(new RegExp(`^## ${n}\\. `, 'm'));
  });

  it('a real product gets the digest, a small tool or a small edit gets the minimum the skill names for a small change', () => {
    expect(designSkillBlock({ route: 'new_project', prompt: 'Une boutique en ligne pour vendre mes bougies avec un panier' })).toBe(CODEN_DESIGN_DIGEST);
    expect(designSkillBlock({ route: 'new_project', prompt: 'cree une mini calculatrice' })).toBe(CODEN_DESIGN_MINIMAL);
    expect(designSkillBlock({ route: 'small_edit', prompt: 'Mets le bouton en vert' })).toBe(CODEN_DESIGN_MINIMAL);
  });

  it('the digest carries every rule family of the skill, and stays short enough to travel with every round', () => {
    for (const rule of [/Tokens first/, /One intention per project/, /Restraint/, /60\/30\/10/, /AA contrast/, /44px/, /Lucide/, /transform and opacity/, /prefers-reduced-motion/, /never rewrites the tokens file/, /Before you finish/]) expect(CODEN_DESIGN_DIGEST).toMatch(rule);
    expect(CODEN_DESIGN_DIGEST.length).toBeLessThan(4_600);
    expect(CODEN_DESIGN_MINIMAL.length).toBeLessThan(800);
  });

  it('bans the violet-blue look and never asks for it', () => {
    expect(CODEN_DESIGN_DIGEST).toMatch(/No violet-blue gradient/);
    for (const text of [CODEN_DESIGN_DIGEST, CODEN_DESIGN_MINIMAL]) expect(text).not.toMatch(/use (?:a )?violet|purple accent/i);
  });

  it('the review uses the skill\'s grid — nine criteria, 100 points — and its delivery bar of 85', () => {
    expect(CODEN_DESIGN_GRID).toHaveLength(9);
    expect(CODEN_DESIGN_GRID.reduce((sum, row) => sum + row.points, 0)).toBe(100);
    expect(designReviewRubric()).toMatch(/total 100/);
    expect(designReviewRubric()).toMatch(/squint test/);
    expect(CODEN_DESIGN_PASS_SCORE).toBe(8.5);
    expect(designReviewPassScore()).toBe(8.5);
  });

  it('a result under 85 gets a polish round, one at or over it does not', async () => {
    const shot = [{ width: 1280, dataUrl: 'data:image/jpeg;base64,AAAA' }];
    const gateway = (text: string) => ({ chat: async () => ({ text, model: 'x', cost_usd: 0.002, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) }) as any;
    const issue = '"issues":[{"area":"hero","problem":"Weak focal point","fix":"Enlarge the headline"}]';
    expect((await runDesignReview({ gateway: gateway(`{"score":8,${issue}}`), prompt: 'shop', screenshots: shot, plan: 'pro', credits: 100 })).instruction).toContain('Weak focal point');
    expect((await runDesignReview({ gateway: gateway(`{"score":8.5,${issue}}`), prompt: 'shop', screenshots: shot, plan: 'pro', credits: 100 })).instruction).toBeUndefined();
  });

  it('CODEN_DESIGN_SKILL=0 gives it all up', () => {
    expect(codenDesignEnabled({})).toBe(true);
    expect(codenDesignEnabled({ CODEN_DESIGN_SKILL: '0' })).toBe(false);
    expect(designSkillBlock({ route: 'new_project', prompt: 'Un CRM complet' }, { CODEN_DESIGN_SKILL: '0' })).toBe('');
  });

  it('reaches the planner, the coder and the team through the same design policy', () => {
    const pipeline = readFileSync('src/services/multi-agent-pipeline.ts', 'utf8');
    expect(pipeline.match(/designContractBlock, designPolicy, designSkill/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the review-and-polish cycle', async () => {
  const { designReviewRounds } = await import('./coden-design-skill');
  const { runCoderLoop } = await import('./sandbox/repair-loop');
  it('one cycle by default, up to four when asked, never more', () => {
    expect(designReviewRounds({})).toBe(1);
    expect(designReviewRounds({ CODEN_DESIGN_REVIEW_ROUNDS: '3' })).toBe(3);
    expect(designReviewRounds({ CODEN_DESIGN_REVIEW_ROUNDS: '9' })).toBe(4);
    expect(designReviewRounds({ CODEN_DESIGN_REVIEW_ROUNDS: '0' })).toBe(1);
    expect(typeof runCoderLoop).toBe('function');
  });
  it('the loop counts the reviews it runs', () => {
    const source = readFileSync('src/services/sandbox/repair-loop.ts', 'utf8');
    expect(source).toMatch(/reviews < maxReviews/);
    expect(source).toMatch(/maxReviews\?: number/);
    expect(readFileSync('src/services/multi-agent-pipeline.ts', 'utf8')).toMatch(/maxReviews: designReviewRounds\(\)/);
  });
});
