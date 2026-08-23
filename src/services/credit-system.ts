import { createClient } from '@supabase/supabase-js';

export interface ActionCostComponents {
  openrouter_cost_usd: number;
  infra_cost_usd: number;
  storage_cost_usd: number;
  build_cost_usd: number;
  domain_operation_cost_usd: number;
  minimum_action_credits?: number;
  complexity_surcharge?: number;
}

export class CostEstimatorService {
  // Real selling price of one credit in USD. This MUST track what a credit
  // actually costs the customer across plans/top-ups, or the margin maths below
  // is fictional. Realized price ranges from $0.0125 (Scale volume top-up) to
  // $0.025 (Pro monthly); 0.02 is the floor we guarantee on every SKU, so the
  // dynamic formula (cost * multiplier / sell_value) never under-charges.
  // NOTE: was 0.20 — a 10x overestimate that made every reported margin false.
  private sell_value_per_credit = 0.02;
  // 3.4x cost coverage targets at least ~70% gross margin before payment fees.
  private minimum_margin_multiplier = 3.4;

  /**
   * Anti-negative margin formula to guarantee sustainable margins per request.
   */
  calculateRequiredCredits(components: ActionCostComponents, user_sell_value?: number): {
    realCostUsd: number;
    requiredCreditsBeforeMargin: number;
    requiredCredits: number;
    finalCredits: number;
    marginEstimated: number;
  } {
    const {
      openrouter_cost_usd,
      infra_cost_usd,
      storage_cost_usd,
      build_cost_usd,
      domain_operation_cost_usd,
      minimum_action_credits = 1,
      complexity_surcharge = 0
    } = components;

    const real_cost_usd = openrouter_cost_usd + infra_cost_usd + storage_cost_usd + build_cost_usd + domain_operation_cost_usd;
    const sell_value_per_credit = user_sell_value || this.sell_value_per_credit;

    // required_credits = ceil_to_0_1( real_cost_usd * margin_mult / sell_value )
    const raw_required_credits = (real_cost_usd * this.minimum_margin_multiplier) / sell_value_per_credit;
    const required_credits = Math.ceil(raw_required_credits * 10) / 10;
    const final_credits = Math.max(minimum_action_credits, required_credits + complexity_surcharge);

    // Revenue in USD from credits charged
    const estimated_revenue_usd = final_credits * sell_value_per_credit;
    const margin_estimated = real_cost_usd > 0 
      ? ((estimated_revenue_usd - real_cost_usd) / estimated_revenue_usd) * 100 
      : 100;

    return {
      realCostUsd: real_cost_usd,
      requiredCreditsBeforeMargin: raw_required_credits,
      requiredCredits: required_credits,
      finalCredits: final_credits,
      marginEstimated: Math.round(margin_estimated * 100) / 100
    };
  }
}

export interface Reservation {
  id: string;
  wallet_id: string;
  amount: number;
  status: 'reserved' | 'committed' | 'released';
  reference_id: string;
  expires_at: string;
}

export class CreditReservationService {
  private supabase: any;

  constructor(supabaseClient: any) {
    this.supabase = supabaseClient;
  }

  async createReservation(organizationId: string, amount: number, referenceId: string, durationMinutes = 15): Promise<Reservation> {
    if (!this.supabase) {
      throw new Error('Supabase client is uninitialized');
    }

    const { data: wallet, error: walletErr } = await this.supabase
      .from('credit_wallets')
      .select('balance')
      .eq('organization_id', organizationId)
      .single();

    if (walletErr || !wallet) {
      throw new Error('Could not locate customer wallet for reservation');
    }

    const currentBalance = parseFloat(wallet.balance);
    if (currentBalance < amount) {
      throw new Error('Transaction blocked: Insufficient wallet balance for reservation');
    }

    const expires_at = new Date(Date.now() + durationMinutes * 60000).toISOString();

    // Deduct from temporary state
    const { data, error } = await this.supabase
      .from('credit_reservations')
      .insert([{
        wallet_id: organizationId,
        amount,
        status: 'reserved',
        reference_id: referenceId,
        expires_at
      }])
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create credit reservation: ${error.message}`);
    }

    // Deduct from wallet balance to lock it during async execution
    const newBalance = currentBalance - amount;
    await this.supabase
      .from('credit_wallets')
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId);

    return data;
  }

  async commitReservation(referenceId: string): Promise<void> {
    if (!this.supabase) return;

    const { data: reservation, error: resErr } = await this.supabase
      .from('credit_reservations')
      .select('*')
      .eq('reference_id', referenceId)
      .single();

    if (resErr || !reservation) {
      console.warn(`No reservation found with reference id: ${referenceId}`);
      return;
    }

    if (reservation.status !== 'reserved') return;

    // Change status
    await this.supabase
      .from('credit_reservations')
      .update({ status: 'committed' })
      .eq('id', reservation.id);

    // Record Ledger Debit Entry
    const { data: wallet } = await this.supabase
      .from('credit_wallets')
      .select('balance')
      .eq('organization_id', reservation.wallet_id)
      .single();

    const finalBalance = wallet ? parseFloat(wallet.balance) : 0;

    await this.supabase
      .from('credit_ledger')
      .insert([{
        wallet_id: reservation.wallet_id,
        type: 'usage',
        amount: -parseFloat(reservation.amount),
        balance_after: finalBalance,
        description: `Action committed successfully: refund windows closed.`,
        reference_id: referenceId
      }]);
  }

  async releaseReservation(referenceId: string, refundPartial = false, partialAmountCharged = 0): Promise<void> {
    if (!this.supabase) return;

    const { data: reservation, error: resErr } = await this.supabase
      .from('credit_reservations')
      .select('*')
      .eq('reference_id', referenceId)
      .single();

    if (resErr || !reservation) return;
    if (reservation.status !== 'reserved') return;

    // Release reservation
    await this.supabase
      .from('credit_reservations')
      .update({ status: 'released' })
      .eq('id', reservation.id);

    // Re-credit the wallet for any unused portion
    const refundAmount = refundPartial 
      ? Math.max(0, parseFloat(reservation.amount) - partialAmountCharged)
      : parseFloat(reservation.amount);

    if (refundAmount > 0) {
      const { data: wallet } = await this.supabase
        .from('credit_wallets')
        .select('balance')
        .eq('organization_id', reservation.wallet_id)
        .single();

      const currentBalance = wallet ? parseFloat(wallet.balance) : 0;
      const newBalance = currentBalance + refundAmount;

      await this.supabase
        .from('credit_wallets')
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq('organization_id', reservation.wallet_id);

      await this.supabase
        .from('credit_ledger')
        .insert([{
          wallet_id: reservation.wallet_id,
          type: 'refund',
          amount: refundAmount,
          balance_after: newBalance,
          description: `Platform automatic refund or reservation partial/full release for event ${referenceId}`,
          reference_id: referenceId
        }]);
    }
  }
}

export class CreditWalletService {
  private supabase: any;
  constructor(supabaseClient: any) {
    this.supabase = supabaseClient;
  }

  async getWalletBalance(organizationId: string): Promise<number> {
    if (!this.supabase) return 0;
    const { data, error } = await this.supabase
      .from('credit_wallets')
      .select('balance')
      .eq('organization_id', organizationId)
      .single();

    if (error || !data) return 0;
    return parseFloat(data.balance);
  }

  async grantCredits(organizationId: string, amount: number, type: string, description: string, referenceId?: string): Promise<number> {
    if (!this.supabase) return 0;

    // Call stored secure SQL function for wallet updates to maintain ledger consistency and RLS safety
    const { data, error } = await this.supabase.rpc('process_credit_transaction', {
      target_wallet_uuid: organizationId,
      amount_tx: amount,
      tx_type: type,
      description: description,
      ref_id: referenceId || ''
    });

    if (error) {
      throw new Error(`Transaction processing failed: ${error.message}`);
    }

    return parseFloat(data);
  }
}

export class CreditLedgerService {
  private supabase: any;
  constructor(supabaseClient: any) {
    this.supabase = supabaseClient;
  }

  async getLedgerHistory(organizationId: string) {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase
      .from('credit_ledger')
      .select('*')
      .eq('wallet_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }
}
