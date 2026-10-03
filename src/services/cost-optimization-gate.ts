import { ROUTING_MODES, type RoutingMode } from '../lib/routing-mode.ts';
export type BenchmarkRow = { taskId: string; mode: RoutingMode; success: boolean; quality: number; latencyMs: number; costUsd: number; realExecution: boolean };
export type BenchmarkGate = { ownerApproved: boolean; qualityNoise: number; latencyNoiseRatio: number; successNoise: number; minTasksPerMode?: number; economyCostRatio?: number; minimumQuality?: number; minimumSuccessRate?: number };
const percentile = (rows: number[], q: number) => [...rows].sort((a,b)=>a-b)[Math.ceil(rows.length*q)-1];
/** Same paired tasks in each mode. Synthetic/unit runs never authorize live traffic. */
export function evaluateOptimization(before: BenchmarkRow[], after: BenchmarkRow[], gate: BenchmarkGate) {
  const reasons: string[] = [];
  if (!gate.ownerApproved) reasons.push('thresholds_not_owner_approved');
  if (!Number.isFinite(gate.qualityNoise) || gate.qualityNoise < 0 || gate.qualityNoise > 100
    || !Number.isFinite(gate.latencyNoiseRatio) || gate.latencyNoiseRatio < 0 || gate.latencyNoiseRatio > 1
    || !Number.isFinite(gate.successNoise) || gate.successNoise < 0 || gate.successNoise > 1
    || (gate.minTasksPerMode !== undefined && (!Number.isInteger(gate.minTasksPerMode) || gate.minTasksPerMode < 30))) reasons.push('invalid_thresholds');
  if ((gate.economyCostRatio !== undefined && (!Number.isFinite(gate.economyCostRatio) || gate.economyCostRatio <= 0 || gate.economyCostRatio >= 1))
    || (gate.minimumQuality !== undefined && (!Number.isFinite(gate.minimumQuality) || gate.minimumQuality < 0 || gate.minimumQuality > 100))
    || (gate.minimumSuccessRate !== undefined && (!Number.isFinite(gate.minimumSuccessRate) || gate.minimumSuccessRate < 0 || gate.minimumSuccessRate > 1))) reasons.push('invalid_thresholds');
  if (before.some(r=>!r.realExecution)||after.some(r=>!r.realExecution)) reasons.push('real_executions_required');
  if ([...before,...after].some(r=>!ROUTING_MODES.includes(r.mode) || !r.taskId || typeof r.success !== 'boolean' || ![r.quality,r.latencyMs,r.costUsd].every(n=>Number.isFinite(n)&&n>=0) || r.quality>100)) reasons.push('invalid_measurement');
  const modes = ROUTING_MODES.map(mode => {
    const b = before.filter(r=>r.mode===mode), a = after.filter(r=>r.mode===mode);
    const ids = (rows: BenchmarkRow[])=>rows.map(r=>r.taskId).sort().join('\0');
    if (b.length < Math.max(30,gate.minTasksPerMode||30) || a.length!==b.length || new Set(b.map(r=>r.taskId)).size!==b.length || new Set(a.map(r=>r.taskId)).size!==a.length || ids(a)!==ids(b)) reasons.push(`${mode}:paired_30_tasks_required`);
    const stats = (rows: BenchmarkRow[]) => ({ success: rows.length ? rows.filter(r=>r.success).length/rows.length : 0, quality: rows.length ? rows.reduce((s,r)=>s+r.quality,0)/rows.length : 0, p50: percentile(rows.map(r=>r.latencyMs),.5), p95: percentile(rows.map(r=>r.latencyMs),.95), costPerSuccess: rows.some(r=>r.success) ? rows.reduce((s,r)=>s+r.costUsd,0)/rows.filter(r=>r.success).length : null });
    const baseline=stats(b), candidate=stats(a);
    if (candidate.success + gate.successNoise < baseline.success) reasons.push(`${mode}:success_regression`);
    if (candidate.quality + gate.qualityNoise < baseline.quality) reasons.push(`${mode}:quality_regression`);
    if (candidate.p50 > baseline.p50*(1+gate.latencyNoiseRatio) || candidate.p95 > baseline.p95*(1+gate.latencyNoiseRatio)) reasons.push(`${mode}:latency_regression`);
    if (candidate.costPerSuccess===null || baseline.costPerSuccess===null || candidate.costPerSuccess >= baseline.costPerSuccess) reasons.push(`${mode}:no_measured_saving`);
    if (gate.minimumQuality !== undefined && candidate.quality < gate.minimumQuality) reasons.push(`${mode}:quality_floor_not_met`);
    if (gate.minimumSuccessRate !== undefined && candidate.success < gate.minimumSuccessRate) reasons.push(`${mode}:success_floor_not_met`);
    return { mode, baseline, candidate };
  });
  // Cross-mode promises are meaningful only on the same reference tasks.
  const taskSet = (rows: BenchmarkRow[], mode: RoutingMode) => rows.filter(row=>row.mode===mode).map(row=>row.taskId).sort().join('\0');
  for(const mode of ROUTING_MODES.slice(1)) {
    if(taskSet(before,mode)!==taskSet(before,ROUTING_MODES[0]) || taskSet(after,mode)!==taskSet(after,ROUTING_MODES[0])) reasons.push('common_reference_tasks_required');
  }
  const economy = modes.find(row=>row.mode==='economy')!.candidate;
  const balanced = modes.find(row=>row.mode==='balanced')!.candidate;
  const performance = modes.find(row=>row.mode==='performance')!.candidate;
  if (gate.economyCostRatio !== undefined && economy.costPerSuccess !== null && balanced.costPerSuccess !== null && economy.costPerSuccess > balanced.costPerSuccess * gate.economyCostRatio) reasons.push('economy:not_distinctly_cheaper');
  if (performance.quality + gate.qualityNoise < balanced.quality || performance.success + gate.successNoise < balanced.success) reasons.push('performance:below_balanced');
  return { eligible: reasons.length===0, rollback: reasons.some(r=>r.includes('regression')), reasons:[...new Set(reasons)], modes };
}
export function observeCostCeiling(spentUsd: number, capUsd: number | null, ownerApproved = false, enforcement = false) {
  if (!Number.isFinite(spentUsd) || spentUsd<0 || capUsd===null || !Number.isFinite(capUsd) || capUsd<=0) return { level: null, block: false, reason: 'valid_owner_ceiling_required' };
  const ratio=spentUsd/capUsd;
  return { level: ratio>=1 ? 100 : ratio>=.9 ? 90 : ratio>=.7 ? 70 : null, block: ownerApproved && enforcement && ratio>=1, reason: 'observation_unless_explicitly_approved' };
}
