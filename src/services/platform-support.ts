export interface TelemetryLog {
  user_id: string;
  organization_id: string;
  project_id?: string;
  action_type: string;
  cost_credits: number;
  cost_usd: number;
  model_used?: string;
}

export class UsageMeteringService {
  private supabase: any;

  constructor(supabaseClient: any) {
    this.supabase = supabaseClient;
  }

  async logUsage(telemetry: TelemetryLog): Promise<void> {
    if (!this.supabase) return;
    try {
      const { error } = await this.supabase
        .from('usage_events')
        .insert([{
          organization_id: telemetry.organization_id,
          project_id: telemetry.project_id || null,
          user_id: telemetry.user_id,
          action_type: telemetry.action_type,
          cost_credits: telemetry.cost_credits,
          cost_usd: telemetry.cost_usd,
          model_used: telemetry.model_used || null,
          created_at: new Date().toISOString()
        }]);

      if (error) {
        console.error('[METERING] Failed to write usage event:', error);
      }
    } catch (e) {
      console.error('[METERING] Err:', e);
    }
  }
}

export class MemberLimitService {
  private supabase: any;

  constructor(supabaseClient: any) {
    this.supabase = supabaseClient;
  }

  /**
   * Safe guards for multi-member budgets to prevent rogue billing usage
   */
  async checkMemberBudget(organizationId: string, userId: string, requestedAmount: number): Promise<boolean> {
    if (!this.supabase) return true;

    const { data: limit, error } = await this.supabase
      .from('member_credit_limits')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !limit) {
      // No custom budget set for member: implicitly allowed (passes upstream to organization wallet checks)
      return true;
    }

    const consumed = parseFloat(limit.consumed || 0);
    const budget = parseFloat(limit.monthly_budget);

    if (consumed + requestedAmount > budget) {
      return false;
    }

    return true;
  }

  async consumeMemberBudget(organizationId: string, userId: string, amount: number): Promise<void> {
    if (!this.supabase) return;

    try {
      await this.supabase.rpc('increment_member_budget', {
        org_id: organizationId,
        usr_id: userId,
        val: amount
      });
    } catch (e) {
      // fallback if RPC isn't loaded: regular upsert
      const { data: limit } = await this.supabase
        .from('member_credit_limits')
        .select('consumed')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .maybeSingle();

      if (limit) {
        const next = parseFloat(limit.consumed) + amount;
        await this.supabase
          .from('member_credit_limits')
          .update({ consumed: next, updated_at: new Date().toISOString() })
          .eq('organization_id', organizationId)
          .eq('user_id', userId);
      }
    }
  }
}

export class BillingAlertService {
  private supabase: any;

  constructor(supabaseClient: any) {
    this.supabase = supabaseClient;
  }

  /**
   * Fires system-wide alerts for margins dropping too low, abnormal volume spikes, or budget warning marks.
   */
  async triggerAlert(organizationId: string, type: 'budget_warning' | 'margin_alert' | 'high_usage', severity: 'info' | 'warning' | 'critical', message: string): Promise<void> {
    console.warn(`[BILLING ALERT] [${severity.toUpperCase()}] ${type}: ${message} (Org: ${organizationId})`);
    
    if (!this.supabase) return;

    try {
      await this.supabase
        .from('billing_alerts')
        .insert([{
          organization_id: organizationId,
          type,
          severity,
          message,
          is_resolved: false,
          created_at: new Date().toISOString()
        }]);
    } catch (err) {
      console.error('[ALERTS] Failed logging alert to DB:', err);
    }
  }
}

export class AuditLogService {
  private supabase: any;

  constructor(supabaseClient: any) {
    this.supabase = supabaseClient;
  }

  async logAudit(data: { user_id: string; organization_id?: string; project_id?: string; requested_model?: string; reason: string; source: string }): Promise<void> {
    console.log(`[AUDIT LOG] user: ${data.user_id}, source: ${data.source}, action: ${data.reason}`);
    
    if (!this.supabase) return;

    try {
      await this.supabase
        .from('audit_logs')
        .insert([{
          user_id: data.user_id,
          organization_id: data.organization_id || null,
          project_id: data.project_id || null,
          requested_model: data.requested_model || null,
          reason: data.reason,
          source: data.source,
          created_at: new Date().toISOString()
        }]);
    } catch (err) {
      console.error('[AUDIT] Failed logging audit to DB:', err);
    }
  }
}
