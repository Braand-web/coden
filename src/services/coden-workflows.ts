/** Pure workflow policy helpers shared by the API and the scheduler. */

export type CodenWorkflowTrigger = 'manual' | 'schedule' | 'project_change' | 'build_failed' | 'preview_invalid';
export type CodenWorkflowStatus = 'active' | 'paused' | 'disabled';

export type CodenWorkflowInput = {
  name: string;
  skill_id: string;
  trigger_type: CodenWorkflowTrigger;
  cron?: string | null;
  budget?: Record<string, unknown>;
};

export type CodenWorkflowDefinition = CodenWorkflowInput & {
  id?: string;
  project_id: string;
  organization_id: string;
  status: CodenWorkflowStatus;
  next_run_at?: string | null;
};

const CRON_PARTS = 5;
const FIELD_RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]] as const;

function parseCronField(value: string, min: number, max: number): Set<number> | null {
  const result = new Set<number>();
  for (const part of value.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) return null;
    const range = rangePart === '*' ? [min, max] : rangePart.split('-').map(Number);
    if (range.length === 1 && Number.isInteger(range[0])) range.push(range[0]);
    if (range.length !== 2 || !range.every(Number.isInteger) || range[0] < min || range[1] > max || range[0] > range[1]) return null;
    for (let current = range[0]; current <= range[1]; current += step) result.add(current);
  }
  return result.size ? result : null;
}

export function parseCronExpression(cron: string): [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>] | null {
  const fields = String(cron || '').trim().split(/\s+/);
  if (fields.length !== CRON_PARTS) return null;
  const parsed = fields.map((field, index) => parseCronField(field, FIELD_RANGES[index][0], FIELD_RANGES[index][1]));
  return parsed.every(Boolean) ? parsed as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>] : null;
}

export function isValidWorkflowCron(cron: string | null | undefined): boolean {
  return Boolean(cron && parseCronExpression(cron));
}

export function nextCronOccurrence(cron: string, from = new Date()): Date | null {
  const parsed = parseCronExpression(cron);
  if (!parsed) return null;
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);
  // A year is enough for the supported workspace schedules and prevents an
  // invalid expression from causing an unbounded scheduler loop.
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    if (parsed[0].has(candidate.getMinutes()) && parsed[1].has(candidate.getHours()) && parsed[2].has(candidate.getDate()) && parsed[3].has(candidate.getMonth() + 1) && parsed[4].has(candidate.getDay())) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

export function validateWorkflowInput(input: CodenWorkflowInput): string[] {
  const errors: string[] = [];
  if (!input.name || input.name.trim().length < 2) errors.push('name_required');
  if (!/^[a-z][a-z0-9_-]{1,31}$/i.test(input.skill_id)) errors.push('skill_id_invalid');
  if (!['manual', 'schedule', 'project_change', 'build_failed', 'preview_invalid'].includes(input.trigger_type)) errors.push('trigger_type_invalid');
  if (input.trigger_type === 'schedule' && !isValidWorkflowCron(input.cron)) errors.push('cron_invalid');
  if (input.trigger_type !== 'schedule' && input.cron) errors.push('cron_only_allowed_for_schedule');
  return errors;
}

export function workflowIdempotencyKey(workflowId: string, trigger: CodenWorkflowTrigger, scheduledAt: string): string {
  return `${workflowId}:${trigger}:${scheduledAt.slice(0, 16)}`;
}

export function workflowIsDue(workflow: Pick<CodenWorkflowDefinition, 'status' | 'trigger_type' | 'next_run_at'>, now = new Date()): boolean {
  return workflow.status === 'active' && workflow.trigger_type === 'schedule' && Boolean(workflow.next_run_at) && new Date(workflow.next_run_at as string).getTime() <= now.getTime();
}

export function computeNextWorkflowRun(workflow: Pick<CodenWorkflowDefinition, 'trigger_type' | 'cron'>, from = new Date()): string | null {
  return workflow.trigger_type === 'schedule' && workflow.cron ? nextCronOccurrence(workflow.cron, from)?.toISOString() || null : null;
}
