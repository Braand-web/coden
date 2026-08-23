import { UserPlan } from '../config/ai-models.ts';

export const RESERVED_SUBDOMAINS = new Set([
  'admin', 'api', 'www', 'app', 'billing', 'support', 'assets', 'jobs', 'portal', 
  'cdn', 'static', 'auth', 'oauth', 'dev', 'prod', 'staging', 'test', 'status',
  'account', 'help', 'legal', 'privacy', 'terms', 'signup', 'login'
]);

export interface DNSRecordInstruction {
  type: 'A' | 'CNAME' | 'TXT';
  name: string;
  value: string;
  status: 'pending' | 'verified' | 'failed';
}

export interface VercelVerificationChallenge {
  type?: string;
  domain?: string;
  name?: string;
  value?: string;
  reason?: string;
}

export interface VercelDomainAssociation {
  vercel_domain_id: string;
  verification_token: string;
  verified: boolean;
  verification: VercelVerificationChallenge[];
  raw?: any;
}

export interface VercelDeploymentAlias {
  alias: string;
  deployment_id: string;
  raw?: any;
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

export class VercelDomainService {
  private apiToken: string;
  private teamId?: string;

  constructor(apiToken: string, teamId?: string) {
    this.apiToken = apiToken;
    this.teamId = teamId;
  }

  private buildTeamQuery() {
    const params = new URLSearchParams();
    if (this.teamId) params.set('teamId', this.teamId);
    return params.toString() ? `?${params.toString()}` : '';
  }

  private async vercelRequest<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`https://api.vercel.com${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    const text = await response.text().catch(() => '');
    let payload: any = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text };
      }
    }

    if (!response.ok) {
      const message =
        payload?.error?.message ||
        payload?.message ||
        `Vercel API returned ${response.status}`;
      const error = new Error(message) as Error & { statusCode?: number; payload?: any };
      error.statusCode = response.status;
      error.payload = payload;
      throw error;
    }

    return payload as T;
  }

  async addDomainToVercel(projectId: string, domain: string): Promise<VercelDomainAssociation> {
    const payload = await this.vercelRequest<any>(
      `/v10/projects/${encodeURIComponent(projectId)}/domains${this.buildTeamQuery()}`,
      {
        method: 'POST',
        body: JSON.stringify({ name: domain }),
      },
    );

    const verification = Array.isArray(payload.verification) ? payload.verification : [];
    const txtChallenge =
      verification.find((item: any) => String(item?.type || '').toUpperCase() === 'TXT') ||
      verification.find((item: any) => item?.value) ||
      null;

    return {
      vercel_domain_id: String(payload.id || payload.name || domain),
      verification_token: String(txtChallenge?.value || ''),
      verified: Boolean(payload.verified),
      verification,
      raw: payload,
    };
  }

  async ensureDomainOnProject(projectId: string, domain: string): Promise<VercelDomainAssociation> {
    try {
      return await this.addDomainToVercel(projectId, domain);
    } catch (error: any) {
      const message = String(error?.message || '');
      const sameProjectAlreadyConfigured =
        /already|exists|configured|added/i.test(message) &&
        !/another|different|other project|other team/i.test(message);

      if (!sameProjectAlreadyConfigured) throw error;

      return {
        vercel_domain_id: domain,
        verification_token: '',
        verified: true,
        verification: [],
        raw: error?.payload || { reused: true, message },
      };
    }
  }

  async assignDeploymentAlias(deploymentId: string, domain: string): Promise<VercelDeploymentAlias> {
    const payload = await this.vercelRequest<any>(
      `/v2/deployments/${encodeURIComponent(deploymentId)}/aliases${this.buildTeamQuery()}`,
      {
        method: 'POST',
        body: JSON.stringify({ alias: domain }),
      },
    );

    return {
      alias: String(payload?.alias || payload?.url || payload?.name || domain),
      deployment_id: String(payload?.deploymentId || payload?.deployment?.id || deploymentId),
      raw: payload,
    };
  }

  async verifyVercelDomain(projectId: string, domain: string): Promise<{ verified: boolean; error?: string; raw?: any; verification?: VercelVerificationChallenge[] }> {
    try {
      const payload = await this.vercelRequest<any>(
        `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}/verify${this.buildTeamQuery()}`,
        { method: 'POST' },
      );

      return {
        verified: Boolean(payload.verified),
        raw: payload,
        verification: Array.isArray(payload.verification) ? payload.verification : [],
      };
    } catch (error: any) {
      return {
        verified: false,
        error: error?.message || 'Vercel domain verification failed.',
        raw: error?.payload,
      };
    }
  }

  async removeDomainFromVercel(projectId: string, domain: string): Promise<boolean> {
    await this.vercelRequest(
      `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}${this.buildTeamQuery()}`,
      { method: 'DELETE' },
    );
    return true;
  }
}

function sanitizeDomainInput(domain: string) {
  const sanitized = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');

  if (!sanitized || sanitized.length > 253 || sanitized.includes('..') || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(sanitized)) {
    throw new Error('Enter a valid domain name without protocol or path.');
  }

  return sanitized;
}

function normalizeRecordType(value: unknown): DNSRecordInstruction['type'] {
  const type = String(value || 'TXT').toUpperCase();
  return type === 'A' || type === 'CNAME' || type === 'TXT' ? type : 'TXT';
}

function buildRoutingRecord(domain: string): Omit<DNSRecordInstruction, 'status'> {
  const parts = domain.split('.').filter(Boolean);
  const isSubdomain = parts.length > 2;
  if (isSubdomain) {
    return {
      type: 'CNAME',
      name: domain.startsWith('www.') ? 'www' : parts[0],
      value: 'cname.vercel-dns.com',
    };
  }
  return {
    type: 'A',
    name: '@',
    value: '76.76.21.21',
  };
}

export function buildDnsRecordInstructionsFromVercel(
  domain: string,
  verification: VercelVerificationChallenge[] = [],
  status: DNSRecordInstruction['status'] = 'pending',
): DNSRecordInstruction[] {
  const records = verification
    .map((item: any) => ({
      type: normalizeRecordType(item?.type),
      name: String(item?.domain || item?.name || domain).trim() || domain,
      value: String(item?.value || '').trim(),
      status,
    }))
    .filter(record => record.value);

  const routing = { ...buildRoutingRecord(domain), status };
  const seen = new Set<string>();
  return [...records, routing].filter(record => {
    const key = `${record.type}:${record.name}:${record.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class DomainService {
  private supabase: any;
  private vercel: VercelDomainService;

  constructor(supabaseClient: any, vercelService: VercelDomainService) {
    this.supabase = supabaseClient;
    this.vercel = vercelService;
  }

  /**
   * Main entry endpoint to register a domain (subdomain or custom)
   */
  async registerDomain(
    organizationId: string,
    projectId: string,
    domain: string,
    type: 'subdomain' | 'custom',
    userPlan: UserPlan | 'pro' | 'scale' | 'enterprise'
  ) {
    if (!this.supabase) throw new Error('Supabase integration missing');

    const sanitized = sanitizeDomainInput(domain);

    // 1. Reserved subdomain protection
    if (type === 'subdomain') {
      const parts = sanitized.split('.');
      const sub = parts[0];
      if (RESERVED_SUBDOMAINS.has(sub)) {
        throw new Error(`The subdomain prefix '${sub}' is reserved for platform workflows and cannot be registered.`);
      }
    }

    // 2. Plan Limit Checks
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

    // 3. Uniqueness Check
    const { data: existing } = await this.supabase
      .from('domains')
      .select('id')
      .eq('domain', sanitized)
      .neq('status', 'removed')
      .maybeSingle();

    if (existing) {
      throw new Error(`The domain/subdomain ${sanitized} has already been registered in another tenant.`);
    }

    // 4. Register
    const vercelProjectId = process.env.VERCEL_PROJECT_ID || '';
    if (!vercelProjectId) {
      throw new Error('Vercel domain operations are not configured. Add VERCEL_PROJECT_ID on Railway.');
    }
    const vercelResp = await this.vercel.addDomainToVercel(vercelProjectId, sanitized);
    const dnsStatus: DNSRecordInstruction['status'] = vercelResp.verified ? 'verified' : 'pending';
    const dnsRecords = type === 'custom'
      ? buildDnsRecordInstructionsFromVercel(sanitized, vercelResp.verification, dnsStatus)
      : [];

    const { data, error } = await this.supabase
      .from('domains')
      .insert([{
        organization_id: organizationId,
        project_id: projectId,
        domain: sanitized,
        type,
        status: type === 'subdomain' || vercelResp.verified ? 'active' : 'pending',
        vercel_project_id: vercelProjectId,
        vercel_domain_id: vercelResp.vercel_domain_id,
        verification_token: vercelResp.verification_token || null,
        last_checked_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;

    if (type === 'custom') {
      for (const rec of dnsRecords) {
        await this.supabase
          .from('dns_verifications')
          .insert([{
            domain_id: data.id,
            record_type: rec.type,
            record_name: rec.name,
            record_value: rec.value,
            status: rec.status
          }]);
      }
    }

    return { ...data, dns_records: dnsRecords };
  }

  async verifyDnsRecords(projectId: string, domainId: string): Promise<any> {
    if (!this.supabase) throw new Error('Database unconfigured');

    const { data: domain, error: dErr } = await this.supabase
      .from('domains')
      .select('*')
      .eq('id', domainId)
      .eq('project_id', projectId)
      .single();

    if (dErr || !domain) {
      throw new Error(`Domain not found or unauthorized: ${domainId}`);
    }

    const { verified, error: vErr, verification } = await this.vercel.verifyVercelDomain(domain.vercel_project_id, domain.domain);

    const now = new Date().toISOString();
    let status = verified ? 'active' : 'pending';
    let errorMessage = null;
    const dnsRecords = buildDnsRecordInstructionsFromVercel(
      domain.domain,
      verification || [],
      verified ? 'verified' : 'pending',
    );

    if (verified) {
      await this.supabase
        .from('domains')
        .update({ status: 'active', verified_at: now, last_checked_at: now, error_message: null })
        .eq('id', domainId);

      await this.supabase
        .from('dns_verifications')
        .update({ status: 'verified', checked_at: now })
        .eq('domain_id', domainId);
    } else {
      errorMessage = vErr || 'DNS validation checked, but records have not propagated yet. Please re-try in a few minutes.';
      await this.supabase
        .from('domains')
        .update({ status: 'pending', last_checked_at: now, error_message: errorMessage })
        .eq('id', domainId);

      if (dnsRecords.length) {
        await this.supabase
          .from('dns_verifications')
          .delete()
          .eq('domain_id', domainId);

        for (const rec of dnsRecords) {
          await this.supabase
            .from('dns_verifications')
            .insert([{
              domain_id: domainId,
              record_type: rec.type,
              record_name: rec.name,
              record_value: rec.value,
              status: rec.status,
              checked_at: now,
            }]);
        }
      }
    }

    return {
      domain_id: domainId,
      status,
      error: errorMessage,
      dns_records: dnsRecords,
    };
  }

  async removeDomain(projectId: string, domainId: string): Promise<void> {
    if (!this.supabase) return;

    const { data: domain, error } = await this.supabase
      .from('domains')
      .select('*')
      .eq('id', domainId)
      .eq('project_id', projectId)
      .single();

    if (error || !domain) {
      throw new Error('Authorized domain target not found');
    }

    if (!domain.vercel_project_id) {
      throw new Error('Vercel project id is missing for this domain.');
    }

    await this.vercel.removeDomainFromVercel(domain.vercel_project_id, domain.domain);

    // Hard / Soft delete depending on compliance state
    await this.supabase
      .from('domains')
      .update({ status: 'removed', updated_at: new Date().toISOString() })
      .eq('id', domainId);
  }

  async setPrimaryDomain(projectId: string, domainId: string): Promise<void> {
    if (!this.supabase) return;

    // Reset all domains of project to primary = false
    await this.supabase
      .from('domains')
      .update({ is_primary: false })
      .eq('project_id', projectId);

    // Set target to primary
    const { error } = await this.supabase
      .from('domains')
      .update({ is_primary: true })
      .eq('id', domainId)
      .eq('project_id', projectId);

    if (error) throw error;
  }
}
