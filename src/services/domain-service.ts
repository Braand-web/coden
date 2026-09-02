/**
 * Custom domains for published projects.
 *
 * This used to talk to Vercel. Coden publishes to Cloudflare, `VERCEL_TOKEN`
 * has never been set on the deployment, and the `domains` table is empty — so
 * every one of the five `/api/projects/:id/domains` routes answered
 * "Vercel domain operations are not configured" to any user who tried to add
 * a domain, while the working Cloudflare functions sat on different routes.
 *
 * The provider is now a port with one Cloudflare implementation. What is kept
 * is everything that was never provider-specific and is worth keeping: reserved
 * subdomains, per-plan limits, cross-tenant uniqueness, and the Supabase record
 * of what was asked for.
 */

import { UserPlan } from '../config/ai-models.ts';
import type { GeneratedAppRuntime } from './generated-app-runtime.ts';
import { attachUserCustomDomain, getCustomDomainStatus, removeCustomDomain } from './publish-cloudflare.ts';

export const RESERVED_SUBDOMAINS = new Set([
  'admin', 'api', 'www', 'app', 'billing', 'support', 'assets', 'jobs', 'portal',
  'cdn', 'static', 'auth', 'oauth', 'dev', 'prod', 'staging', 'test', 'status',
  'account', 'help', 'legal', 'privacy', 'terms', 'signup', 'login',
]);

export interface DNSRecordInstruction {
  type: 'A' | 'CNAME' | 'TXT';
  name: string;
  value: string;
  status: 'pending' | 'verified' | 'failed';
}

/**
 * What the user is told, in the order a domain moves through it.
 *
 * The stored `status` stays `pending | active | removed`, which is what the
 * rest of the server reads. This is the finer state the interface shows.
 */
export type DomainState =
  | 'configuration_required'
  | 'dns_verification'
  | 'dns_propagation'
  | 'active'
  | 'error';

export const DOMAIN_STATE_LABELS: Record<DomainState, { fr: string; en: string }> = {
  configuration_required: { fr: 'Configuration requise', en: 'Configuration required' },
  dns_verification: { fr: 'Vérification DNS', en: 'DNS verification' },
  dns_propagation: { fr: 'Propagation DNS', en: 'DNS propagation' },
  active: { fr: 'Actif', en: 'Active' },
  error: { fr: 'Erreur', en: 'Error' },
};

export function domainStateLabel(state: DomainState, language: 'fr' | 'en' = 'fr'): string {
  return DOMAIN_STATE_LABELS[state][language];
}

/** The host that actually serves the domain. One implementation: Cloudflare. */
export interface DomainHostProvider {
  attach(domain: string): Promise<{ instructions: DNSRecordInstruction[] }>;
  status(domain: string): Promise<{ active: boolean; detail: string | null; certificate: string | null }>;
  detach(domain: string): Promise<void>;
}

/** Cloudflare, for one published project. */
export function createCloudflareDomainProvider(
  cfName: string,
  runtime: GeneratedAppRuntime = 'static-assets',
): DomainHostProvider {
  if (!cfName) throw new Error('This project has no published deployment yet, so a domain cannot be attached to it.');
  return {
    async attach(domain: string) {
      const result = await attachUserCustomDomain(cfName, domain, runtime);
      return {
        instructions: (result.instructions || []).map(record => ({
          type: (record.type as DNSRecordInstruction['type']) || 'CNAME',
          name: record.name,
          value: record.value,
          status: 'pending' as const,
        })),
      };
    },
    async status(domain: string) {
      const result: any = await getCustomDomainStatus(cfName, domain, runtime);
      const raw = String(result?.status || '').toLowerCase();
      return {
        active: raw === 'active' || raw === 'verified' || raw === 'succeeded',
        detail: raw || null,
        certificate: result?.certificate_status ?? null,
      };
    },
    async detach(domain: string) {
      await removeCustomDomain(cfName, domain, runtime);
    },
  };
}

export class domainPlanLimits {
  static getCustomDomainLimit(plan: string | any): number {
    switch (String(plan).toLowerCase()) {
      case 'enterprise':
        return 9999;
      case 'scale':
        return 10;
      case 'pro':
        return 1;
      case 'free':
      default:
        return 0;
    }
  }
}

export function sanitizeDomainInput(domain: string): string {
  return String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

/**
 * The user-facing state of a stored domain.
 *
 * A domain the host has accepted and certified is active. One the host knows
 * about but has not validated is still waiting on DNS — split between "we have
 * not seen your records yet" and "we have, they are spreading" so the user can
 * tell a mistake from a wait. Anything the host reports as failed is an error,
 * and a domain with no DNS instructions yet still needs configuring.
 */
export function resolveDomainState(input: {
  status?: string | null;
  hostDetail?: string | null;
  hasInstructions?: boolean;
  errorMessage?: string | null;
}): DomainState {
  const status = String(input.status || '').toLowerCase();
  const detail = String(input.hostDetail || '').toLowerCase();
  if (status === 'active' || status === 'verified') return 'active';
  if (/fail|error|invalid|blocked|moved/.test(detail)) return 'error';
  if (!input.hasInstructions) return 'configuration_required';
  if (/pending|initializing|provision|deploy/.test(detail)) return 'dns_propagation';
  return 'dns_verification';
}

export class DomainService {
  private supabase: any;
  private hostSource: DomainHostProvider | (() => Promise<DomainHostProvider>);
  private resolvedHost: DomainHostProvider | null = null;

  /**
   * The host may be given as a factory. Resolving it costs a runtime-contract
   * read and fails for a project with no deployment yet, so an operation that
   * only touches our own records — reordering domains, say — must not pay for
   * it or be blocked by it.
   */
  constructor(supabaseClient: any, host: DomainHostProvider | (() => Promise<DomainHostProvider>)) {
    this.supabase = supabaseClient;
    this.hostSource = host;
  }

  private async host(): Promise<DomainHostProvider> {
    if (this.resolvedHost) return this.resolvedHost;
    this.resolvedHost = typeof this.hostSource === 'function' ? await this.hostSource() : this.hostSource;
    return this.resolvedHost;
  }

  /** Register a subdomain or a custom domain for a project. */
  async registerDomain(
    organizationId: string,
    projectId: string,
    domain: string,
    type: 'subdomain' | 'custom',
    userPlan: UserPlan | 'pro' | 'scale' | 'enterprise',
  ) {
    if (!this.supabase) throw new Error('Supabase integration missing');

    const sanitized = sanitizeDomainInput(domain);
    if (!sanitized || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(sanitized)) {
      throw new Error(`"${domain}" is not a valid domain name.`);
    }

    if (type === 'subdomain') {
      const sub = sanitized.split('.')[0];
      if (RESERVED_SUBDOMAINS.has(sub)) {
        throw new Error(`The subdomain prefix '${sub}' is reserved for platform workflows and cannot be registered.`);
      }
    }

    if (type === 'custom') {
      const limit = domainPlanLimits.getCustomDomainLimit(userPlan as any);
      const { count } = await this.supabase
        .from('domains')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('type', 'custom')
        .neq('status', 'removed');

      if ((count || 0) >= limit) {
        throw new Error(`Your plan (${userPlan}) allows up to ${limit} custom domains. Please upgrade to add more domains.`);
      }
    }

    const { data: existing } = await this.supabase
      .from('domains')
      .select('id')
      .eq('domain', sanitized)
      .neq('status', 'removed')
      .maybeSingle();

    if (existing) {
      throw new Error(`The domain/subdomain ${sanitized} has already been registered in another tenant.`);
    }

    const attached = await (await this.host()).attach(sanitized);
    const dnsRecords = type === 'custom' ? attached.instructions : [];

    const { data, error } = await this.supabase
      .from('domains')
      .insert([{
        organization_id: organizationId,
        project_id: projectId,
        domain: sanitized,
        type,
        status: type === 'subdomain' ? 'active' : 'pending',
        last_checked_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (error) throw error;

    for (const record of dnsRecords) {
      await this.supabase.from('dns_verifications').insert([{
        domain_id: data.id,
        record_type: record.type,
        record_name: record.name,
        record_value: record.value,
        status: record.status,
      }]);
    }

    return {
      ...data,
      dns_records: dnsRecords,
      state: resolveDomainState({ status: data.status, hasInstructions: dnsRecords.length > 0 }),
    };
  }

  /** Ask the host whether the domain is live yet, and record the answer. */
  async verifyDnsRecords(projectId: string, domainId: string): Promise<any> {
    if (!this.supabase) throw new Error('Database unconfigured');

    const { data: domain, error: loadError } = await this.supabase
      .from('domains')
      .select('*')
      .eq('id', domainId)
      .eq('project_id', projectId)
      .single();

    if (loadError || !domain) throw new Error(`Domain not found or unauthorized: ${domainId}`);

    const now = new Date().toISOString();
    let hostStatus: { active: boolean; detail: string | null; certificate: string | null };
    try {
      hostStatus = await (await this.host()).status(domain.domain);
    } catch (error: any) {
      const message = error?.message || 'The hosting provider could not be reached to check this domain.';
      await this.supabase.from('domains')
        .update({ last_checked_at: now, error_message: message })
        .eq('id', domainId);
      return { domain_id: domainId, status: domain.status, state: 'error' as DomainState, error: message, dns_records: [] };
    }

    const { data: records } = await this.supabase
      .from('dns_verifications')
      .select('record_type,record_name,record_value,status')
      .eq('domain_id', domainId);

    const dnsRecords: DNSRecordInstruction[] = (records || []).map((record: any) => ({
      type: record.record_type,
      name: record.record_name,
      value: record.record_value,
      status: hostStatus.active ? 'verified' : record.status,
    }));

    if (hostStatus.active) {
      await this.supabase.from('domains')
        .update({ status: 'active', verified_at: now, last_checked_at: now, error_message: null })
        .eq('id', domainId);
      await this.supabase.from('dns_verifications')
        .update({ status: 'verified', checked_at: now })
        .eq('domain_id', domainId);
      return { domain_id: domainId, status: 'active', state: 'active' as DomainState, error: null, dns_records: dnsRecords };
    }

    const message = 'The DNS records are not visible yet. They can take a few minutes to spread.';
    await this.supabase.from('domains')
      .update({ status: 'pending', last_checked_at: now, error_message: message })
      .eq('id', domainId);

    return {
      domain_id: domainId,
      status: 'pending',
      state: resolveDomainState({
        status: 'pending',
        hostDetail: hostStatus.detail,
        hasInstructions: dnsRecords.length > 0,
      }),
      error: message,
      dns_records: dnsRecords,
    };
  }

  /** Detach at the host, then mark it removed. */
  async removeDomain(projectId: string, domainId: string): Promise<void> {
    if (!this.supabase) return;

    const { data: domain, error } = await this.supabase
      .from('domains')
      .select('*')
      .eq('id', domainId)
      .eq('project_id', projectId)
      .single();

    if (error || !domain) throw new Error('Authorized domain target not found');

    // A host that has already forgotten the domain must not block the user from
    // removing it on our side — the record is what their interface shows.
    await this.host().then(host => host.detach(domain.domain)).catch(() => null);

    await this.supabase
      .from('domains')
      .update({ status: 'removed', updated_at: new Date().toISOString() })
      .eq('id', domainId);
  }

  async setPrimaryDomain(projectId: string, domainId: string): Promise<void> {
    if (!this.supabase) return;

    await this.supabase.from('domains').update({ is_primary: false }).eq('project_id', projectId);

    const { error } = await this.supabase
      .from('domains')
      .update({ is_primary: true })
      .eq('id', domainId)
      .eq('project_id', projectId);

    if (error) throw error;
  }
}
