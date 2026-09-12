/**
 * What an application costs to host, and what that is worth in credits.
 *
 * Coden declares seven cloud usage categories, grants every plan twenty cloud
 * credits a month, and shows customers a storage and bandwidth allowance — and
 * none of it was ever measured. `usage_events` holds exactly one kind of row,
 * `ai_gateway/conversation`; `cloud_wallets` holds none at all; and
 * `compatibilityCloud()` returns zero for every limit it advertises. The shape
 * of the model was right and completely hollow.
 *
 * This module is the missing middle: it converts a measured quantity of real
 * infrastructure into credits, and nothing else. It performs no I/O, reads no
 * database and charges nobody. That is deliberate — a pricing table is the one
 * part of a billing system that must be reviewable on its own, because every
 * mistake in it is an overcharge to a real customer.
 *
 * Three counters stay separate, because they answer different questions:
 *
 *   BUILD   the agent, the sandbox, the model calls that write the app
 *   CLOUD   what the published app consumes: database, network, storage,
 *           compute, realtime                      ← this file
 *   AI      models called from inside the published app, at runtime
 */

/*
 * The categories live here rather than in `billing-service`, because this is
 * the module that decides what each one costs. A category nothing can price is
 * a promise the interface cannot keep, and keeping the list beside the price
 * table is what makes `unmeteredCategories()` below able to say so.
 */
export type CloudUsageCategory =
  | 'database_server'
  | 'database_storage'
  | 'compute'
  | 'file_storage'
  | 'live_updates'
  | 'network'
  | 'ai_app_usage';

export const CLOUD_USAGE_CATEGORIES: CloudUsageCategory[] = [
  'database_server', 'database_storage', 'compute', 'file_storage', 'live_updates', 'network', 'ai_app_usage',
];

/** A thing that can be measured, and the unit it is measured in. */
export type CloudMeter =
  | 'worker_requests'
  | 'worker_cpu_ms'
  | 'database_storage_gb_month'
  | 'database_compute_hours'
  | 'database_egress_gb'
  | 'file_storage_gb_month'
  | 'file_read_operations'
  | 'file_write_operations'
  | 'realtime_messages';

type MeterSpec = {
  readonly category: CloudUsageCategory;
  /** The unit one quantity of this meter represents, stored on the usage row. */
  readonly unit: string;
  /** Raw infrastructure cost in USD for ONE unit. */
  readonly rawCostUsd: number;
  /** Where that number comes from, so it can be re-checked rather than trusted. */
  readonly source: string;
};

/*
 * List prices as published by Cloudflare and Supabase, read 2026-09.
 *
 * They are recorded per single unit — not per million — so the arithmetic below
 * never hides a factor of 10^6 in a constant. Egress from Workers and R2 is
 * genuinely zero, which is most of why this architecture is affordable; it is
 * written as 0 rather than omitted, so that an absent meter is distinguishable
 * from a free one.
 *
 * These are LIST prices and they move. `assertPricesAreFresh` exists so a stale
 * table becomes a loud test failure rather than a quiet mispricing.
 */
const METERS: Readonly<Record<CloudMeter, MeterSpec>> = {
  worker_requests: {
    category: 'compute',
    unit: 'request',
    rawCostUsd: 0.30 / 1_000_000,
    source: 'Cloudflare Workers for Platforms: $0.30 per million requests beyond the included 20M.',
  },
  worker_cpu_ms: {
    category: 'compute',
    unit: 'cpu_ms',
    rawCostUsd: 0.02 / 1_000_000,
    source: 'Cloudflare Workers: $0.02 per million CPU milliseconds beyond the included 60M.',
  },
  database_storage_gb_month: {
    category: 'database_storage',
    unit: 'gb_month',
    rawCostUsd: 0.125,
    source: 'Supabase: $0.125 per GB per month of database storage beyond the included 8GB.',
  },
  database_compute_hours: {
    category: 'database_server',
    unit: 'hour',
    // A Micro instance is $10/month; a month of continuous running is ~730h.
    rawCostUsd: 10 / 730,
    source: 'Supabase compute: Micro at $10/month, amortised over 730 hours.',
  },
  database_egress_gb: {
    category: 'network',
    unit: 'gb',
    rawCostUsd: 0.09,
    source: 'Supabase: $0.09 per GB of egress beyond the included 250GB.',
  },
  file_storage_gb_month: {
    category: 'file_storage',
    unit: 'gb_month',
    rawCostUsd: 0.015,
    source: 'Cloudflare R2: $0.015 per GB per month.',
  },
  file_read_operations: {
    category: 'file_storage',
    unit: 'operation',
    rawCostUsd: 0.36 / 1_000_000,
    source: 'Cloudflare R2 Class B: $0.36 per million read operations.',
  },
  file_write_operations: {
    category: 'file_storage',
    unit: 'operation',
    rawCostUsd: 4.50 / 1_000_000,
    source: 'Cloudflare R2 Class A: $4.50 per million write operations.',
  },
  realtime_messages: {
    category: 'live_updates',
    unit: 'message',
    rawCostUsd: 2.50 / 1_000_000,
    source: 'Supabase Realtime: $2.50 per million messages beyond the included allowance.',
  },
};

/**
 * The multiplier between raw infrastructure cost and what a customer pays.
 *
 * Three, which lands gross margin around 67%. It is not greed: reselling
 * infrastructure at cost loses money the moment anything goes wrong — support,
 * fraud, a traffic spike absorbed mid-month, payment fees, and the control
 * plane itself, none of which appear on the Cloudflare invoice.
 */
export const CLOUD_MARKUP = 3;

/**
 * What one credit is worth, in USD.
 *
 * Derived from the Pro plan rather than chosen: 100 credits for $25/month.
 * Business sells credits at twice that, which is why the same infrastructure
 * deducts fewer Business credits — the credit is a unit of money, not of
 * compute, and this is the one place that conversion happens.
 */
export const USD_PER_CLOUD_CREDIT = 25 / 100;

/** The raw infrastructure cost of a measured quantity, in USD. */
export function rawCloudCostUsd(meter: CloudMeter, quantity: number): number {
  const spec = METERS[meter];
  if (!spec) throw new Error(`Unknown cloud meter: ${meter}`);
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return spec.rawCostUsd * quantity;
}

/**
 * The credits a measured quantity costs the customer.
 *
 * Fractional on purpose. A published app serving a hundred requests has cost
 * something far below one credit, and rounding that up would charge a customer
 * a quarter of a dollar for a tenth of a cent of traffic — thirty thousand
 * times the real cost. The interface shows "13.8 / 100", so the number behind
 * it has to be able to be 13.8.
 */
export function creditsForCloudUsage(meter: CloudMeter, quantity: number): number {
  const usd = rawCloudCostUsd(meter, quantity) * CLOUD_MARKUP;
  if (usd <= 0) return 0;
  // Six decimals: enough that a single request is not rounded to nothing, and
  // few enough that the stored number is exact in float and readable in a log.
  return Number((usd / USD_PER_CLOUD_CREDIT).toFixed(6));
}

/** Which usage category a meter settles under, for the ledger row. */
export function categoryForMeter(meter: CloudMeter): CloudUsageCategory {
  const spec = METERS[meter];
  if (!spec) throw new Error(`Unknown cloud meter: ${meter}`);
  return spec.category;
}

/** The unit a meter is measured in, stored alongside the quantity. */
export function unitForMeter(meter: CloudMeter): string {
  const spec = METERS[meter];
  if (!spec) throw new Error(`Unknown cloud meter: ${meter}`);
  return spec.unit;
}

/** Every meter, with its price and provenance. For the pricing page and audits. */
export function describeCloudMeters(): Array<{ meter: CloudMeter } & MeterSpec> {
  return (Object.keys(METERS) as CloudMeter[]).map(meter => ({ meter, ...METERS[meter] }));
}

/**
 * Every declared category is reachable by at least one meter.
 *
 * A category with no meter is a line the interface promises to report and never
 * can — which is precisely the state this module was written to end. Exported
 * rather than run at import: a server must not fail to boot over a pricing
 * table, but a test must fail over it.
 */
export function unmeteredCategories(): CloudUsageCategory[] {
  const metered = new Set(Object.values(METERS).map(spec => spec.category));
  return CLOUD_USAGE_CATEGORIES.filter(category => !metered.has(category));
}
