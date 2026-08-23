import assert from 'node:assert/strict';
import { computeNextWorkflowRun, isValidWorkflowCron, nextCronOccurrence, validateWorkflowInput, workflowIdempotencyKey, workflowIsDue } from './src/services/coden-workflows.ts';

assert.equal(isValidWorkflowCron('0 9 * * 1-5'), true);
assert.equal(isValidWorkflowCron('every morning'), false);
assert.equal(validateWorkflowInput({ name: 'Nightly security', skill_id: 'security', trigger_type: 'schedule', cron: '0 2 * * *' }).length, 0);
assert.ok(nextCronOccurrence('*/15 * * * *', new Date('2026-08-14T10:01:00Z')));
assert.ok(computeNextWorkflowRun({ trigger_type: 'schedule', cron: '0 * * * *' }));
assert.equal(computeNextWorkflowRun({ trigger_type: 'manual', cron: null }), null);
const due = { status: 'active' as const, trigger_type: 'schedule' as const, next_run_at: '2026-08-14T09:00:00Z' };
assert.equal(workflowIsDue(due, new Date('2026-08-14T10:00:00Z')), true);
assert.equal(workflowIsDue({ ...due, status: 'paused' }, new Date('2026-08-14T10:00:00Z')), false);
assert.equal(workflowIdempotencyKey('w1', 'schedule', '2026-08-14T09:12:30Z'), 'w1:schedule:2026-08-14T09:12');
console.log('coden workflow tests passed');
