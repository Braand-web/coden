import { createHash } from 'node:crypto';
import { ACTION_CREDIT_PRICES, type BillableAction } from '../config/billing-v2.ts';
import { insertUnifiedUsageEvent } from './unified-usage-store.ts';

export const CONVERSATION_CREDITS = 0.5;
export function customerActionCredits(action: BillableAction | 'conversation'): number {
  return action === 'conversation' ? CONVERSATION_CREDITS : ACTION_CREDIT_PRICES[action];
}
export class BillingLedgerUnavailableError extends Error {
  readonly diagnosticCode: string;
  readonly status = 503;
  constructor(diagnosticCode='BILLING_LEDGER_UNAVAILABLE') {
    super('The credit ledger is temporarily unavailable.');this.diagnosticCode=diagnosticCode;
  }
}
export function paidOperationsPaused():boolean { return process.env.CODEN_PAID_OPERATIONS_PAUSED==='1'; }
export function assertPaidOperationsAvailable():void {
  if (!paidOperationsPaused()) return;
  throw new BillingLedgerUnavailableError('PAID_OPERATIONS_PAUSED');
}
/** A client nonce names the action, never grants access or supplies its price. */
export function billingActionIdentity(accountId: string, projectId: string, route: string, nonce: unknown): string {
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9:_-]{8,160}$/.test(nonce)) throw new Error('A stable action identifier is required.');
  return createHash('sha256').update(JSON.stringify([accountId, projectId, route, nonce])).digest('hex');
}
export function billingActionFingerprint(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

/** A crash cannot separate the replayable answer from its settlement journal. */
export async function completeDeliveredAction(client: any,input: {
  actionId:string;accountId:string;result:unknown;reservationId?:string|null;
  usage?:Parameters<typeof insertUnifiedUsageEvent>[1];credits?:number;completeCostUsd?:number;
  delivery?: { project_id:string; actor_id:string; message?:{content:string;intent?:string;requested_mode?:string;ai_message_id?:string;metadata?:Record<string,unknown>};
    project?:Record<string,unknown>;files?:Array<Record<string,unknown>> };
}):Promise<void> {
  const {error}=await client.rpc('coden_billing_complete_action',{
    p_action_id:input.actionId,p_account_id:input.accountId,p_result:input.result,
    p_reservation_id:input.reservationId || null,p_usage_payload:input.usage || null,
    p_credits:input.credits ?? 0,p_complete_cost_usd:Number((input.completeCostUsd ?? 0).toFixed(10)),
    p_delivery:input.delivery || null,
  });
  if (error) throw new BillingLedgerUnavailableError();
}

/** Persist the delivered work's accounting before attempting its event/settlement. */
export async function checkpointDeliveredUsage(client: any, input: {
  reservationId: string; usage: Parameters<typeof insertUnifiedUsageEvent>[1]; credits: number; completeCostUsd: number;
}): Promise<void> {
  const cost = Number(input.completeCostUsd.toFixed(10));
  if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(input.credits) || input.credits <= 0) throw new BillingLedgerUnavailableError();
  const row = { reservation_id: input.reservationId, account_id: input.usage.account_id,
    usage_payload: input.usage, credits_charged: input.credits, complete_cost_usd: cost };
  const saved = await client.from('billing_delivery_checkpoints').insert(row);
  if (!saved.error) return;
  if (saved.error.code === '23505') {
    const prior = await client.from('billing_delivery_checkpoints').select('account_id,usage_payload,credits_charged,complete_cost_usd')
      .eq('reservation_id', input.reservationId).maybeSingle();
    // Timestamp is event metadata, not authority to change a delivered price.
    if (!prior.error && prior.data?.account_id === row.account_id
      && prior.data.usage_payload?.idempotency_key === input.usage.idempotency_key
      && Number(prior.data.credits_charged) === input.credits && Number(prior.data.complete_cost_usd) === cost) return;
  }
  throw new BillingLedgerUnavailableError();
}

export async function queueDeliveredSettlement(client: any, input: {
  reservationId: string; usageEventId: string; credits: number; completeCostUsd: number;
}) {
  const row = { reservation_id: input.reservationId, usage_event_id: input.usageEventId,
    credits_charged: input.credits, complete_cost_usd: Number(input.completeCostUsd.toFixed(10)) };
  const { error } = await client.from('billing_settlement_outbox').insert(row);
  if (!error) return;
  if (error.code === '23505') {
    const prior = await client.from('billing_settlement_outbox').select('usage_event_id,credits_charged,complete_cost_usd')
      .eq('reservation_id', input.reservationId).maybeSingle();
    if (!prior.error && prior.data?.usage_event_id === input.usageEventId
      && Number(prior.data.credits_charged) === input.credits && Number(prior.data.complete_cost_usd) === row.complete_cost_usd) return;
  }
  throw new BillingLedgerUnavailableError();
}

export async function retryDeliveredSettlements(client: any, limit = 100): Promise<number> {
  const checkpoints = await client.from('billing_delivery_checkpoints')
    .select('reservation_id,account_id,usage_payload,credits_charged,complete_cost_usd').eq('status', 'pending')
    .order('created_at', { ascending: true }).limit(Math.min(500, Math.max(1, limit)));
  if (checkpoints.error) throw new BillingLedgerUnavailableError();
  for (const row of checkpoints.data || []) {
    try {
      if (row.usage_payload?.account_id !== row.account_id) throw new BillingLedgerUnavailableError();
      const usageEventId = await insertUnifiedUsageEvent(client, row.usage_payload);
      await queueDeliveredSettlement(client, { reservationId: row.reservation_id, usageEventId,
        credits: Number(row.credits_charged), completeCostUsd: Number(row.complete_cost_usd) });
    } catch {
      // Retained for the next pass. Never release credit belonging to delivered work.
    }
  }
  const pending = await client.from('billing_settlement_outbox')
    .select('reservation_id,usage_event_id,credits_charged,complete_cost_usd').eq('status','pending')
    .order('created_at',{ ascending: true }).limit(Math.min(500, Math.max(1, limit)));
  if (pending.error) throw new BillingLedgerUnavailableError();
  let settled = 0;
  for (const row of pending.data || []) {
    const result = await client.rpc('coden_billing_settle', {
      p_reservation_id: row.reservation_id, p_usage_event_id: row.usage_event_id,
      p_credits_charged: Number(row.credits_charged), p_complete_cost_usd: Number(row.complete_cost_usd), p_realized_revenue_usd: 0,
    });
    if (!result.error) settled++;
  }
  return settled;
}
