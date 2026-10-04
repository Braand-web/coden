import { normalizeBillingPlan } from '../config/billing-v2.ts';
import { CLOUD_MARKUP, USD_PER_CLOUD_CREDIT, describeCloudMeters } from './cloud-metering.ts';

export const CLOUD_TARIFF_VERSION = '2026-10-04.cloud-reference-v1';
export const CLOUD_GRACE_HOURS = 72;
export const CLOUD_GRACE_CREDITS = Object.freeze({ free:1,pro:5,business:10,enterprise:10 });
export type CloudGrace = { started_at:string; budget_credits:number; used_credits:number; paid_replenishment_id:string|null };
export function cloudGraceState(row: CloudGrace|null, now=new Date()) {
  if (!row) return {status:'not_started' as const,expiresAt:null,creditsRemaining:0};
  const starts=Date.parse(row.started_at);
  if (!Number.isFinite(starts) || !Number.isFinite(row.budget_credits) || !Number.isFinite(row.used_credits)
    || row.budget_credits<0 || row.used_credits<0) throw new Error('Invalid cloud grace record.');
  const expiresAt=new Date(starts+CLOUD_GRACE_HOURS*3_600_000).toISOString();
  const creditsRemaining=Math.max(0,Number((row.budget_credits-row.used_credits).toFixed(10)));
  return {status:now.getTime()<Date.parse(expiresAt)&&creditsRemaining>0?'active' as const:'exhausted' as const,expiresAt,creditsRemaining};
}
export function cloudGraceBudget(plan:unknown) { return CLOUD_GRACE_CREDITS[normalizeBillingPlan(plan) || 'free']; }
export function cloudReferenceTariff() {
  return { version:CLOUD_TARIFF_VERSION,checkedAt:'2026-10-04',markup:CLOUD_MARKUP,usdPerCredit:USD_PER_CLOUD_CREDIT,
    meters:describeCloudMeters().map(row=>({...row,creditsPerUnit:Number((row.rawCostUsd*CLOUD_MARKUP/USD_PER_CLOUD_CREDIT).toFixed(10))})),
    exclusions:['included_static_publication','coden_central_resources','user_owned_provider_accounts','unattributed_shared_resources'],
  };
}
/** This flag alone is never sufficient: each collector also needs verified attribution. */
export function cloudBillingEnabled() { return process.env.CODEN_CLOUD_MEASURED_BILLING_V1==='1'; }
