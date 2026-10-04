import { afterEach,describe,expect,it,vi } from 'vitest';
import { cloudBillingEnabled,cloudGraceBudget,cloudGraceState,cloudReferenceTariff } from './cloud-billing';
import { creditsForCloudUsage } from './cloud-metering';
afterEach(()=>vi.unstubAllEnvs());
describe('Cloud tariff and protected grace',()=>{
  it.each([['free',1],['pro',5],['business',10]] as const)('caps %s grace at %s credit(s)',(plan,expected)=>expect(cloudGraceBudget(plan)).toBe(expected));
  it('expires at the first of 72 hours or the credit budget',()=>{
    const row={started_at:'2026-10-01T00:00:00Z',budget_credits:5,used_credits:4.999,paid_replenishment_id:null};
    expect(cloudGraceState(row,new Date('2026-10-03T23:59:59Z')).status).toBe('active');
    expect(cloudGraceState(row,new Date('2026-10-04T00:00:00Z')).status).toBe('exhausted');
    expect(cloudGraceState({...row,used_credits:5},new Date('2026-10-01T00:00:01Z')).status).toBe('exhausted');
  });
  it('never extends a stored grace period on reload',()=>{
    const row={started_at:'2026-10-01T00:00:00Z',budget_credits:1,used_credits:0.1,paid_replenishment_id:null};
    expect(cloudGraceState(row,new Date('2026-10-02')).expiresAt).toBe(cloudGraceState(row,new Date('2026-10-03')).expiresAt);
  });
  it('uses the validated common conversion, with no minimum per request',()=>{
    expect(creditsForCloudUsage('database_storage_gb_month',1)).toBe(1.5);
    expect(creditsForCloudUsage('worker_cpu_ms',1)).toBe(0.00000024);
    expect(creditsForCloudUsage('worker_requests',100)).toBeCloseTo(100*creditsForCloudUsage('worker_requests',1),10);
    expect(cloudReferenceTariff().exclusions).toContain('unattributed_shared_resources');
  });
  it('does not enable unreliable collectors by default',()=>{
    vi.stubEnv('CODEN_CLOUD_MEASURED_BILLING_V1','0');expect(cloudBillingEnabled()).toBe(false);
  });
});
