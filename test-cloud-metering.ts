// Unit tests for the Cloud metering cost math (pure part, no Supabase I/O).
// Guards the structural fix where published-app infrastructure was granted but
// never debited.

import assert from 'node:assert/strict';
import { CloudMeteringService, type OrgUsageSample } from './src/services/cloud-metering.ts';

const svc = new CloudMeteringService(null); // null client: we only test pure math

// Zero usage costs nothing.
{
  const sample: OrgUsageSample = {
    organizationId: 'org1', databaseStorageGb: 0, fileStorageGb: 0, networkGb: 0, computeInvocations: 0,
  };
  const { total, breakdown } = svc.realCostUsd(sample, 1);
  assert.equal(total, 0);
  assert.equal(breakdown.length, 4, 'always reports the 4 categories');
  assert.ok(breakdown.every(b => b.usd === 0));
}

// Storage is prorated by the cycle fraction of a month.
{
  const sample: OrgUsageSample = {
    organizationId: 'org1', databaseStorageGb: 10, fileStorageGb: 0, networkGb: 0, computeInvocations: 0,
  };
  const full = svc.realCostUsd(sample, 1).breakdown.find(b => b.category === 'database_storage')!;
  const half = svc.realCostUsd(sample, 0.5).breakdown.find(b => b.category === 'database_storage')!;
  assert.ok(full.usd > 0, 'storage has a cost');
  assert.ok(Math.abs(half.usd - full.usd / 2) < 1e-9, 'storage cost prorates linearly with the cycle');
}

// Network is NOT prorated (it is a per-GB egress charge for the cycle's traffic).
{
  const sample: OrgUsageSample = {
    organizationId: 'org1', databaseStorageGb: 0, fileStorageGb: 0, networkGb: 100, computeInvocations: 0,
  };
  const a = svc.realCostUsd(sample, 1).breakdown.find(b => b.category === 'network')!;
  const b = svc.realCostUsd(sample, 0.1).breakdown.find(x => x.category === 'network')!;
  assert.equal(a.usd, b.usd, 'network cost does not depend on cycle fraction');
  assert.ok(a.usd > 0);
}

// Total is the sum of the breakdown.
{
  const sample: OrgUsageSample = {
    organizationId: 'org1', databaseStorageGb: 5, fileStorageGb: 3, networkGb: 12, computeInvocations: 2_000_000,
  };
  const { total, breakdown } = svc.realCostUsd(sample, 1);
  const sum = breakdown.reduce((acc, b) => acc + b.usd, 0);
  assert.ok(Math.abs(total - sum) < 1e-9, 'total equals the sum of category costs');
  assert.ok(total > 0);
}

console.log('test-cloud-metering passed');
