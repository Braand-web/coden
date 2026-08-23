/**
 * Coden Cloud metering.
 *
 * Closes the structural margin leak: published-app infrastructure (database
 * storage, file storage, bandwidth, compute) is granted as a USD balance but was
 * NEVER debited. This service reads real usage, applies a markup, debits the
 * wallet atomically (via the debit_cloud_balance SQL function), and suspends
 * apps whose balance is exhausted.
 *
 * Two backend modes:
 *  - 'shared'   : apps live in app_* schemas of our own Supabase. Storage is read
 *                 with collect_app_schema_bytes(); bandwidth/compute come from a
 *                 request log (cloud_request_log).
 *  - 'dedicated': each org has its own Supabase project; pull usage from the
 *                 Supabase Management API (collectDedicatedUsage(), stubbed).
 *
 * SECURITY: no secrets here. The Supabase client is injected; the management
 * token (dedicated mode) must be read from the environment, never hardcoded.
 *
 * ⚠️ Set UNIT_COST_USD to your REAL Supabase provider unit costs and MARKUP to
 *    your target margin before relying on the debited amounts. The defaults are
 *    conservative placeholders, NOT verified provider prices.
 */

// ── Pricing knobs (USD). PLACEHOLDERS — replace with real provider costs. ─────
const MARKUP = 2.0; // bill 2x the real provider cost on Cloud

const UNIT_COST_USD = {
  database_storage_per_gb_month: 0.125, // TODO: set to your Supabase $/GB-month
  file_storage_per_gb_month: 0.021, // TODO
  network_per_gb: 0.09, // TODO: egress $/GB
  compute_per_million_invocations: 2.0, // TODO: edge function invocations
};

export type CloudBackendMode = 'shared' | 'dedicated';

export interface OrgUsageSample {
  organizationId: string;
  projectId?: string | null;
  databaseStorageGb: number;
  fileStorageGb: number;
  networkGb: number;
  computeInvocations: number;
}

type LedgerBreakdownLine = { category: string; usd: number; qty: number; unit: string };

export class CloudMeteringService {
  private supabase: any;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(supabaseClient: any) {
    this.supabase = supabaseClient;
  }

  /** Real provider cost (pre-markup) for one usage sample, prorated per cycle. */
  realCostUsd(sample: OrgUsageSample, cycleFractionOfMonth: number): { total: number; breakdown: LedgerBreakdownLine[] } {
    const dbUsd = sample.databaseStorageGb * UNIT_COST_USD.database_storage_per_gb_month * cycleFractionOfMonth;
    const fileUsd = sample.fileStorageGb * UNIT_COST_USD.file_storage_per_gb_month * cycleFractionOfMonth;
    const netUsd = sample.networkGb * UNIT_COST_USD.network_per_gb;
    const computeUsd = (sample.computeInvocations / 1_000_000) * UNIT_COST_USD.compute_per_million_invocations;

    return {
      total: dbUsd + fileUsd + netUsd + computeUsd,
      breakdown: [
        { category: 'database_storage', usd: dbUsd, qty: sample.databaseStorageGb, unit: 'GB-cycle' },
        { category: 'file_storage', usd: fileUsd, qty: sample.fileStorageGb, unit: 'GB-cycle' },
        { category: 'network', usd: netUsd, qty: sample.networkGb, unit: 'GB' },
        { category: 'compute', usd: computeUsd, qty: sample.computeInvocations, unit: 'invocations' },
      ],
    };
  }

  /** Debit one org for one billing cycle. Returns the new balance. */
  async meterOrg(sample: OrgUsageSample, cycleFractionOfMonth: number): Promise<number | null> {
    if (!this.supabase) return null;
    const { breakdown } = this.realCostUsd(sample, cycleFractionOfMonth);
    let newBalance: number | null = null;
    for (const line of breakdown) {
      if (line.usd <= 0) continue;
      const { data, error } = await this.supabase.rpc('debit_cloud_balance', {
        org_id: sample.organizationId,
        spend_usd: line.usd * MARKUP,
        category: line.category,
        qty: line.qty,
        unit_label: line.unit,
        note: `Metered ${line.category} (markup ${MARKUP}x)`,
        ref: `meter_${Date.now()}`,
        proj_id: sample.projectId || null,
      });
      if (error) {
        console.warn(`[coden:cloud_meter_failed] ${sample.organizationId} ${line.category}: ${error.message}`);
        continue;
      }
      newBalance = data == null ? newBalance : Number(data);
    }
    return newBalance;
  }

  /** Is this org's Cloud suspended? Published apps must check this on every request. */
  async isSuspended(organizationId: string): Promise<boolean> {
    if (!this.supabase) return false;
    const { data } = await this.supabase
      .from('cloud_wallets')
      .select('status,balance_usd')
      .eq('organization_id', organizationId)
      .maybeSingle();
    return data?.status === 'suspended' || Number(data?.balance_usd || 0) <= 0;
  }

  // ── SHARED MODE COLLECTORS ────────────────────────────────────────────────

  /** Storage per app_* schema, resolved to org/project via projects.cloud_schema. */
  async collectSharedStorage(): Promise<Map<string, { org: string; project: string | null; gb: number }>> {
    const out = new Map<string, { org: string; project: string | null; gb: number }>();
    if (!this.supabase) return out;

    const { data: rows, error } = await this.supabase.rpc('collect_app_schema_bytes');
    if (error || !rows) return out;

    const { data: projects } = await this.supabase
      .from('projects')
      .select('id, organization_id, cloud_schema');
    const schemaToProject = new Map<string, { org: string; project: string }>();
    for (const p of projects || []) {
      if (p.cloud_schema) schemaToProject.set(p.cloud_schema, { org: p.organization_id, project: p.id });
    }

    for (const r of rows as Array<{ schema_name: string; total_bytes: number }>) {
      const map = schemaToProject.get(r.schema_name);
      if (!map) continue;
      out.set(r.schema_name, { org: map.org, project: map.project, gb: Number(r.total_bytes) / 1e9 });
    }
    return out;
  }

  /** Aggregate bandwidth + compute since the last run, from cloud_request_log. */
  async collectSharedTraffic(sinceIso: string): Promise<Map<string, { org: string; project: string | null; networkGb: number; invocations: number }>> {
    const out = new Map<string, { org: string; project: string | null; networkGb: number; invocations: number }>();
    if (!this.supabase) return out;
    const { data } = await this.supabase
      .from('cloud_request_log')
      .select('organization_id, project_id, bytes_out, is_compute')
      .gte('created_at', sinceIso);
    for (const row of data || []) {
      const key = `${row.organization_id}:${row.project_id || ''}`;
      const cur = out.get(key) || { org: row.organization_id, project: row.project_id || null, networkGb: 0, invocations: 0 };
      cur.networkGb += Number(row.bytes_out || 0) / 1e9;
      cur.invocations += row.is_compute ? 1 : 0;
      out.set(key, cur);
    }
    return out;
  }

  // ── DEDICATED MODE (stub) ─────────────────────────────────────────────────
  async collectDedicatedUsage(): Promise<OrgUsageSample[]> {
    // TODO: call the Supabase Management API per org project to pull usage.
    return [];
  }

  // ── RUN ONE CYCLE ──────────────────────────────────────────────────────────
  async runCycle(mode: CloudBackendMode, lastRunIso: string): Promise<void> {
    const now = Date.now();
    const cycleMs = now - new Date(lastRunIso).getTime();
    const cycleFractionOfMonth = Math.max(0, cycleMs) / (30 * 24 * 3600 * 1000);

    const samples = new Map<string, OrgUsageSample>();

    if (mode === 'shared') {
      const storage = await this.collectSharedStorage();
      for (const v of storage.values()) {
        const key = `${v.org}:${v.project || ''}`;
        samples.set(key, {
          organizationId: v.org, projectId: v.project,
          databaseStorageGb: v.gb, fileStorageGb: 0, networkGb: 0, computeInvocations: 0,
        });
      }
      const traffic = await this.collectSharedTraffic(lastRunIso);
      for (const [key, v] of traffic) {
        const s = samples.get(key) || {
          organizationId: v.org, projectId: v.project,
          databaseStorageGb: 0, fileStorageGb: 0, networkGb: 0, computeInvocations: 0,
        };
        s.networkGb += v.networkGb;
        s.computeInvocations += v.invocations;
        samples.set(key, s);
      }
    } else {
      for (const s of await this.collectDedicatedUsage()) {
        samples.set(`${s.organizationId}:${s.projectId || ''}`, s);
      }
    }

    for (const sample of samples.values()) {
      await this.meterOrg(sample, cycleFractionOfMonth).catch(err =>
        console.warn(`[coden:cloud_meter_org_failed] ${sample.organizationId}: ${err?.message || err}`)
      );
    }
    console.log(`[coden:cloud_meter] cycle done, ${samples.size} usage groups metered.`);
  }

  /** Wire into server.ts at boot. Uses setInterval to avoid extra deps. */
  start(mode: CloudBackendMode = 'shared', everyMs = 3600_000) {
    if (this.intervalHandle) return;
    let lastRun = new Date(Date.now() - everyMs).toISOString();
    const tick = async () => {
      const startedAt = new Date().toISOString();
      try {
        await this.runCycle(mode, lastRun);
        lastRun = startedAt;
      } catch (err: any) {
        console.warn(`[coden:cloud_meter_cycle_failed] ${err?.message || err}`);
      }
    };
    this.intervalHandle = setInterval(tick, everyMs);
    void tick();
  }

  stop() {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }
}
