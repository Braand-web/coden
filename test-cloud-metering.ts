import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLOUD_MARKUP,
  CLOUD_USAGE_CATEGORIES,
  USD_PER_CLOUD_CREDIT,
  categoryForMeter,
  creditsForCloudUsage,
  describeCloudMeters,
  rawCloudCostUsd,
  unitForMeter,
  unmeteredCategories,
  type CloudMeter,
} from './src/services/cloud-metering.ts';

/*
 * Hosting is measured, and what it costs is derived rather than invented.
 *
 * Coden declared seven cloud usage categories, granted every plan twenty cloud
 * credits a month, and showed customers a storage and bandwidth allowance —
 * and none of it was ever measured. Production settles it: `usage_events`
 * holds exactly one kind of row, `ai_gateway/conversation`; `cloud_wallets`
 * holds zero rows; and `compatibilityCloud()` returned 0 for every limit it
 * advertised. The model had the right shape and was entirely hollow.
 */

/*
 * ONE — the price table is per single unit.
 *
 * Published prices are quoted per million requests, per GB, per month. Storing
 * them in those units is how a factor of 10^6 hides inside a constant and
 * overcharges every customer by a million times. Each entry here is the cost
 * of exactly one unit, and these bounds are what catch a misplaced divisor.
 */
{
  const meters = describeCloudMeters();
  assert.ok(meters.length >= 9, 'every resource a published app consumes is priced');

  for (const spec of meters) {
    assert.ok(spec.rawCostUsd > 0, `${spec.meter} has a price`);
    assert.ok(spec.rawCostUsd < 1, `${spec.meter} is priced per unit, not per million`);
    assert.ok(spec.source.length > 20, `${spec.meter} says where its price came from`);
    assert.ok(spec.unit.length > 0, `${spec.meter} declares its unit`);
  }

  // A single request costs a small fraction of a cent, not a cent.
  assert.ok(rawCloudCostUsd('worker_requests', 1) < 0.000001, 'one request is sub-microdollar');
  // And a million of them costs the published figure.
  assert.equal(Number(rawCloudCostUsd('worker_requests', 1_000_000).toFixed(4)), 0.30,
    'a million requests costs the $0.30 Cloudflare publishes');
  assert.equal(Number(rawCloudCostUsd('file_storage_gb_month', 100).toFixed(4)), 1.50,
    '100 GB-months of R2 costs the $0.015/GB Cloudflare publishes');
}

/*
 * TWO — credits are fractional, because the alternative overcharges enormously.
 *
 * A published app serving a hundred requests has cost a tiny fraction of a
 * cent. Rounding that up to one credit would bill a quarter of a dollar —
 * tens of thousands of times the real cost. The interface shows "13.8 / 100",
 * so the number behind it has to be able to be 13.8.
 */
{
  const hundredRequests = creditsForCloudUsage('worker_requests', 100);
  assert.ok(hundredRequests > 0, 'a small usage still registers');
  assert.ok(hundredRequests < 0.001, 'and is not rounded up to a whole credit');

  // The conversion is exactly markup over credit value, with nothing else in it.
  const gb = 10;
  const expected = (rawCloudCostUsd('database_egress_gb', gb) * CLOUD_MARKUP) / USD_PER_CLOUD_CREDIT;
  assert.equal(creditsForCloudUsage('database_egress_gb', gb), Number(expected.toFixed(6)),
    'credits are raw cost x markup, converted at the credit value');

  // Nothing is charged for nothing.
  for (const quantity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(creditsForCloudUsage('worker_requests', quantity), 0, `${quantity} costs nothing`);
    assert.equal(rawCloudCostUsd('worker_requests', quantity), 0, `${quantity} has no raw cost`);
  }

  // An unknown meter is a programming error, not a silent zero: a typo must
  // not quietly make a resource free.
  assert.throws(() => creditsForCloudUsage('bandwidth' as CloudMeter, 1), /Unknown cloud meter/);
  assert.throws(() => categoryForMeter('nope' as CloudMeter), /Unknown cloud meter/);
}

/*
 * THREE — the margin is the documented one.
 *
 * Reselling infrastructure at cost loses money the moment anything goes wrong:
 * support, fraud, a spike absorbed mid-month, payment fees, the control plane.
 * This asserts the stated intent rather than the arithmetic, so that changing
 * the markup is a deliberate edit to a tested number.
 */
{
  assert.equal(CLOUD_MARKUP, 3, 'three times raw cost, about 67% gross margin');
  assert.equal(USD_PER_CLOUD_CREDIT, 0.25, 'derived from Pro: 100 credits for $25/month');

  const raw = rawCloudCostUsd('database_egress_gb', 100);
  const billedUsd = creditsForCloudUsage('database_egress_gb', 100) * USD_PER_CLOUD_CREDIT;
  const margin = (billedUsd - raw) / billedUsd;
  assert.ok(margin > 0.6 && margin < 0.7, `gross margin lands near 67%, got ${(margin * 100).toFixed(1)}%`);
}

/*
 * FOUR — every category the interface promises can actually be priced.
 *
 * A category with no meter is a line the Cloud tab reports and can never fill.
 * `ai_app_usage` is the deliberate exception: it is the third counter — models
 * called from inside a published app at runtime — and it is measured in tokens
 * by the AI gateway, not in infrastructure units by this table.
 */
{
  assert.deepEqual(unmeteredCategories(), ['ai_app_usage'],
    'every infrastructure category is metered; only the runtime-AI counter is elsewhere');

  const priced = new Set(describeCloudMeters().map(spec => spec.category));
  for (const category of CLOUD_USAGE_CATEGORIES) {
    if (category === 'ai_app_usage') continue;
    assert.ok(priced.has(category), `${category} has at least one meter`);
  }

  // The unit travels with the measurement, so a stored row can be re-priced
  // later without guessing what its quantity meant.
  assert.equal(unitForMeter('worker_requests'), 'request');
  assert.equal(unitForMeter('file_storage_gb_month'), 'gb_month');
  assert.equal(categoryForMeter('database_egress_gb'), 'network');
}

/*
 * FIVE — the advertised allowance is no longer zero.
 *
 * `compatibilityCloud()` returned 0 for balance, storage and bandwidth on
 * every plan, while the same plans granted 20 cloud credits. The figures are
 * now derived from that grant rather than invented.
 */
{
  const source = readFileSync(new URL('./src/services/billing-service.ts', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('const compatibilityCloud ='), source.indexOf('function planConfig('));

  assert.match(fn, /grants\.monthlyCloudCredits \* USD_PER_CLOUD_CREDIT/, 'the balance follows the declared grant');
  assert.match(fn, /rawCloudCostUsd\(meter, 1\) \* CLOUD_MARKUP/, 'the GB figures are what that grant buys at the metered price');
  assert.doesNotMatch(fn, /balanceUsd: 0,/, 'the zeros are gone');
  assert.doesNotMatch(fn, /bandwidthGb: 0,/, 'including the bandwidth one');
}

/*
 * SIX — a real application fits inside the included allowance.
 *
 * This is the economic sanity check, and the one that would catch a pricing
 * table that is technically consistent and commercially absurd. An app with
 * real traffic must cost a fraction of the twenty included credits, or the
 * "most small apps cost nothing extra" promise is false and every customer
 * meets an unexpected bill.
 */
{
  const monthly: Array<[CloudMeter, number]> = [
    ['worker_requests', 100_000],
    ['database_egress_gb', 2],
    ['file_storage_gb_month', 5],
    ['database_storage_gb_month', 1],
    ['realtime_messages', 50_000],
  ];
  const total = monthly.reduce((sum, [meter, quantity]) => sum + creditsForCloudUsage(meter, quantity), 0);

  assert.ok(total < 20, `a real app fits in the 20-credit allowance, costs ${total.toFixed(2)}`);
  assert.ok(total > 1, `and is not so cheap the meter is pointless, costs ${total.toFixed(2)}`);

  // A genuinely heavy app must exceed it, or the allowance would never bill.
  const heavy = creditsForCloudUsage('database_egress_gb', 200) + creditsForCloudUsage('worker_requests', 5_000_000);
  assert.ok(heavy > 20, `a heavy app exceeds the allowance, costs ${heavy.toFixed(2)}`);
}

console.log('cloud metering tests passed');
