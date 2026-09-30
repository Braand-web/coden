import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { auditGeneratedDesign, hardCodedColors } from './design-quality-auditor';
import { scoreReferenceSet } from '../../scripts/eval-reference-set';
import { blocksTheRun } from './quality-gate-policy';

const set = JSON.parse(readFileSync('evals/reference-set.json', 'utf8'));

describe('the reference set', () => {
  it('has at least thirty tasks over the nine families asked for, each with a stable id and an expectation', () => {
    expect(set.tasks.length).toBeGreaterThanOrEqual(30);
    const categories = new Set(set.tasks.map((task: any) => task.category));
    for (const family of ['saas', 'ecommerce', 'game', 'showcase', 'dashboard', 'bug', 'feature', 'redesign', 'ambiguous']) expect(categories.has(family), family).toBe(true);
    expect(new Set(set.tasks.map((task: any) => task.id)).size).toBe(set.tasks.length);
    for (const task of set.tasks) { expect(task.prompt.length).toBeGreaterThan(0); expect(task.gate.length).toBeGreaterThan(0); expect(typeof task.small).toBe('boolean'); }
  });

  it('is read by the harness as it should be, and does better than before', () => {
    const score = scoreReferenceSet();
    expect(score.smallRead).toBe(score.tasks);
    expect(score.kindAfter).toBe(score.tasks);
    expect(score.kindAfter).toBeGreaterThan(score.kindBefore);
    expect(score.smallSpecialistsAfter).toBe(0);
    expect(score.smallReviewAfter).toBe(0);
    expect(score.smallSpecialistsBefore).toBe(score.smallTasks);
  });
});

describe('colours come from the tokens', () => {
  const app = (content: string) => [{ path: 'src/App.tsx', content }, { path: 'src/index.css', content: ':root{--accent:#3A83F7;--bg:#fff}' }];

  it('counts the colours written in components, never the ones that define the tokens', () => {
    expect(hardCodedColors(app('<div style={{color:"#ff0000"}} className="x" />')).count).toBe(1);
    expect(hardCodedColors(app('<a href="#faq">faq</a><a href="#contact">contact</a>')).count).toBe(0);
    expect(hardCodedColors(app('const c = "rgb(1,2,3)"; const d = "hsla(1,2%,3%,.4)";')).count).toBe(2);
  });

  it('warns — never blocks — on a pattern of them', () => {
    const many = Array.from({ length: 12 }, (_, index) => `<i style={{background:"#${(0x100000 + index).toString(16)}"}}/>`).join('');
    const check = auditGeneratedDesign({ files: app(many), platformType: 'generic_web_app' }).find(item => item.key === 'design_no_hardcoded_colors')!;
    expect(check.status).toBe('fail');
    expect(check.severity).toBe('medium');
    expect(blocksTheRun(check, true)).toBe(false);
    const clean = auditGeneratedDesign({ files: app('<div className="bg-surface text-content" />'), platformType: 'generic_web_app' }).find(item => item.key === 'design_no_hardcoded_colors')!;
    expect(clean.status).toBe('pass');
  });
});
