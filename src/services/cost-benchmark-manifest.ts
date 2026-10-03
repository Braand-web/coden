import { ROUTING_MODES } from '../lib/routing-mode.ts';
import { evaluateOptimization, type BenchmarkGate, type BenchmarkRow } from './cost-optimization-gate.ts';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key=>allowed.includes(key));
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value>=0;
const plans = ['free','pro','pro_plus','business'];
const rowKeys = ['taskId','mode','success','quality','latencyMs','costUsd','realExecution','costSource','iterations','errors'];
type MeasuredRow = BenchmarkRow & { costSource: 'gateway'; iterations: number; errors: number };
type Manifest = { schemaVersion: 1; referenceVersion: number; measurementKind: 'live'; deploymentCommit: string; plan: string; rows: MeasuredRow[] };

/** Private input files are never echoed. No prompts, IDs of users, URLs or emails. */
export function validateCostBenchmarkManifest(value: unknown, reference: { version: number; tasks: { id: string }[] }): Manifest {
  if(!object(value) || !exactKeys(value,['schemaVersion','referenceVersion','measurementKind','deploymentCommit','plan','rows'])) throw new Error('INVALID_MANIFEST_FIELDS');
  if(value.schemaVersion!==1 || value.referenceVersion!==reference.version || value.measurementKind!=='live') throw new Error('LIVE_MATCHING_REFERENCE_REQUIRED');
  if(typeof value.deploymentCommit!=='string' || !/^[a-f0-9]{40}$/.test(value.deploymentCommit) || !plans.includes(String(value.plan))) throw new Error('VALID_COMMIT_AND_PLAN_REQUIRED');
  if(!Array.isArray(value.rows) || value.rows.length>3000) throw new Error('BOUNDED_MEASUREMENTS_REQUIRED');
  const ids=new Set(reference.tasks.map(task=>task.id));
  for(const row of value.rows) {
    if(!object(row) || !exactKeys(row,rowKeys)) throw new Error('INVALID_MEASUREMENT_FIELDS');
    if(typeof row.taskId!=='string' || !ids.has(row.taskId) || !ROUTING_MODES.includes(row.mode as any)) throw new Error('UNKNOWN_REFERENCE_TASK_OR_MODE');
    if(row.realExecution!==true || row.costSource!=='gateway' || typeof row.success!=='boolean') throw new Error('MEASURED_LIVE_TASK_COST_REQUIRED');
    if(![row.quality,row.latencyMs,row.costUsd,row.iterations,row.errors].every(finite) || Number(row.quality)>100 || !Number.isInteger(row.iterations) || !Number.isInteger(row.errors)) throw new Error('INVALID_TASK_METRICS');
  }
  return value as unknown as Manifest;
}

export function validateCostBenchmarkPolicy(value: unknown): BenchmarkGate {
  if(!object(value) || !exactKeys(value,['ownerApproved','qualityNoise','latencyNoiseRatio','successNoise','minTasksPerMode','economyCostRatio','minimumQuality','minimumSuccessRate'])) throw new Error('INVALID_POLICY_FIELDS');
  if(typeof value.ownerApproved!=='boolean' || ![value.qualityNoise,value.latencyNoiseRatio,value.successNoise].every(finite)) throw new Error('INVALID_POLICY_THRESHOLDS');
  // Detailed ranges and optional floors are checked by the fail-closed gate.
  for(const key of ['minTasksPerMode','economyCostRatio','minimumQuality','minimumSuccessRate']) {
    if(value[key]!==undefined && !finite(value[key])) throw new Error('INVALID_POLICY_THRESHOLDS');
  }
  return value as BenchmarkGate;
}

/** Offline evaluator, not an activation tool or proof of the source assertions. */
export function evaluateCostBenchmarkManifests(before: Manifest, after: Manifest, policy: BenchmarkGate) {
  if(before.plan!==after.plan || before.referenceVersion!==after.referenceVersion) throw new Error('MATCHING_PLAN_AND_REFERENCE_REQUIRED');
  const result=evaluateOptimization(before.rows,after.rows,policy);
  const extra=(rows: MeasuredRow[], mode: string)=>{
    const selected=rows.filter(row=>row.mode===mode);
    return {
      tasks:selected.length,
      iterations:selected.length ? selected.reduce((sum,row)=>sum+row.iterations,0)/selected.length : null,
      tasksWithErrors:selected.length ? selected.filter(row=>row.errors>0).length/selected.length : null,
    };
  };
  const reasons=[...result.reasons];
  for(const mode of ROUTING_MODES) {
    const baseline=extra(before.rows,mode), candidate=extra(after.rows,mode);
    if(baseline.tasksWithErrors!==null && candidate.tasksWithErrors!==null && candidate.tasksWithErrors>baseline.tasksWithErrors+policy.successNoise) reasons.push(`${mode}:error_regression`);
  }
  return {
    candidatePassesSuppliedMeasurements:reasons.length===0,
    eligibleForProduction:false,
    independentEvidenceVerificationRequired:true,
    activationPerformed:false,
    plan:before.plan,
    baselineCommit:before.deploymentCommit,
    candidateCommit:after.deploymentCommit,
    referenceVersion:before.referenceVersion,
    rollbackRecommended:result.rollback||reasons.some(reason=>reason.includes('regression')),
    reasons:[...new Set(reasons)],
    modes:result.modes.map(row=>({...row,extra:{baseline:extra(before.rows,row.mode),candidate:extra(after.rows,row.mode)}})),
  };
}
