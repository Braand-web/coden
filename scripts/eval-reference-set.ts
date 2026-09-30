/**
 * The reference set, scored on what the harness decides before it spends a credit.
 *
 *   npm run eval:reference
 *
 * For each of the 32 requests: is it read as small or not, what product kind the checks are held to, and what
 * the run would spend on it at the highest level (specialists, designer review) — earlier behaviour against now.
 * The live half (design marked out of 100, journeys, cost) needs provider credit and is run separately.
 */
import { readFileSync } from 'node:fs';
import { classifyGeneratedAppType } from '../src/services/design-generation-policy.ts';
import { gatePlatformType, isSmallRequest } from '../src/services/quality-gate-policy.ts';
import { resolveQualityPolicy } from '../src/services/quality-tier.ts';
import { designSkillBlock } from '../src/services/coden-design-skill.ts';

type Task = { id: string; category: string; route: 'new_project' | 'small_edit' | 'large_change'; prompt: string; small: boolean; gate: string[] };
const tasks: Task[] = JSON.parse(readFileSync(new URL('../evals/reference-set.json', import.meta.url), 'utf8')).tasks;

export function scoreReferenceSet() {
  const rows = tasks.map(task => {
    const before = { kind: classifyGeneratedAppType(task.prompt), policy: resolveQualityPolicy({ route: task.route, effort: 'Ultra', credits: 500 }) };
    const after = { kind: gatePlatformType(task.prompt, false), policy: resolveQualityPolicy({ route: task.route, effort: 'Ultra', credits: 500, prompt: task.prompt }), small: isSmallRequest(task.prompt), skill: designSkillBlock({ route: task.route, prompt: task.prompt }).split('\n')[0] };
    return { task, before, after };
  });
  const smallTasks = rows.filter(row => row.task.small);
  return {
    tasks: rows.length,
    smallRead: rows.filter(row => row.after.small === row.task.small).length,
    kindBefore: rows.filter(row => row.task.gate.includes(row.before.kind)).length,
    kindAfter: rows.filter(row => row.task.gate.includes(row.after.kind)).length,
    smallTasks: smallTasks.length,
    smallSpecialistsBefore: smallTasks.filter(row => row.before.policy.specialists).length,
    smallSpecialistsAfter: smallTasks.filter(row => row.after.policy.specialists).length,
    smallReviewBefore: smallTasks.filter(row => row.before.policy.designReview).length,
    smallReviewAfter: smallTasks.filter(row => row.after.policy.designReview).length,
    wrong: rows.filter(row => !row.task.gate.includes(row.after.kind)).map(row => row.task.id),
  };
}

if (process.argv[1]?.endsWith('eval-reference-set.ts')) console.log(JSON.stringify(scoreReferenceSet(), null, 2));
