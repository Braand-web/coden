import { readFileSync } from 'node:fs';
import { afterEach,describe, expect, it, vi } from 'vitest';
import { billingActionIdentity, BillingLedgerUnavailableError, checkpointDeliveredUsage, completeDeliveredAction, customerActionCredits, assertPaidOperationsAvailable, queueDeliveredSettlement, retryDeliveredSettlements } from './billing-action';
afterEach(()=>vi.unstubAllEnvs());

function fixture(failure?: string) {
  const rows: Record<string, any[]> = { billing_delivery_checkpoints: [], billing_settlement_outbox: [], usage_events: [] };
  const rpc = vi.fn(async (_: string, args: any) => {
    for (const table of ['billing_delivery_checkpoints', 'billing_settlement_outbox']) {
      const row = rows[table].find(r=>r.reservation_id===args.p_reservation_id);
      if (row) row.status='settled';
    }
    return { data: 'settled', error: null };
  });
  const client: any = { rpc, from(table: string) {
    const filters: Array<[string,unknown]> = [];
    let data: any;
    let error: any = null;
    const q: any = {
      select: () => q, order: () => q, limit: () => q,
      eq: (key: string,value: unknown) => { filters.push([key,value]); return q; },
      insert: (input: any) => {
        const row = Array.isArray(input) ? input[0] : input;
        if (failure===table) error={ code:'XX000' };
        else if (rows[table].some(r => row.reservation_id ? r.reservation_id===row.reservation_id : r.idempotency_key===row.idempotency_key)) error={code:'23505'};
        else { data = { ...row,id:`${table}-id`,status:'pending' }; rows[table].push(data); }
        return q;
      },
      maybeSingle: async () => ({ data: table==='billing_accounts' ? { organization_id:'account' } : data || rows[table].find(r=>filters.every(([k,v])=>r[k]===v)),error }),
      then: (resolve: any) => Promise.resolve({ data: data || rows[table]?.filter(r=>filters.every(([k,v])=>r[k]===v)),error }).then(resolve),
    };
    return q;
  }};
  return {client,rows,rpc};
}

describe('canonical action billing', () => {
  it.each([['conversation',0.5],['targeted_style',0.5],['component',0.9],['plan',1],['feature',1.2],['full_page',1.7]] as const)('prices %s independently of tokens or model', (action,expected) => {
    expect(customerActionCredits(action)).toBe(expected);
  });
  it('scopes network retries to the account, app and endpoint', () => {
    const id=billingActionIdentity('a','p','chat','message-123');
    expect(id).toBe(billingActionIdentity('a','p','chat','message-123'));
    expect(id).not.toBe(billingActionIdentity('b','p','chat','message-123'));
    expect(id).not.toBe(billingActionIdentity('a','q','chat','message-123'));
    expect(()=>billingActionIdentity('a','p','chat',undefined)).toThrow();
  });
  it('does not mistake an unavailable ledger for a request to buy credits', async () => {
    const {client}=fixture('billing_settlement_outbox');
    await expect(queueDeliveredSettlement(client,{ reservationId:'r',usageEventId:'e',credits:0.5,completeCostUsd:0.001 }))
      .rejects.toBeInstanceOf(BillingLedgerUnavailableError);
    expect(new BillingLedgerUnavailableError().diagnosticCode).not.toBe('CREDITS_REQUIRED');
  });
  it('recovers delivered usage after event persistence failed and replays without another debit', async () => {
    const {client,rows,rpc}=fixture();
    const input={ reservationId:'r',usage:{ account_id:'account',category:'ai_gateway',model:'fixture',complete_cost_usd:0.001,idempotency_key:'stable:event' },credits:0.5,completeCostUsd:0.001 };
    await checkpointDeliveredUsage(client,input);
    await checkpointDeliveredUsage(client,input);
    expect(rows.billing_delivery_checkpoints).toHaveLength(1);
    expect(await retryDeliveredSettlements(client)).toBe(1);
    expect(await retryDeliveredSettlements(client)).toBe(0);
    expect(rows.usage_events).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    await expect(checkpointDeliveredUsage(client,{...input,credits:1.7})).rejects.toBeInstanceOf(BillingLedgerUnavailableError);
  });
  it('has no reachable V3 pricing routes or writes', () => {
    const server=readFileSync(new URL('../../server.ts',import.meta.url),'utf8');
    expect(server).not.toMatch(/app\.(get|post|put|delete|patch)\(['"]\/api\/(admin\/)?billing\/pricing/);
    expect(server).not.toMatch(/v3_credits|loadActivePricingConfig|observeV3Pricing/);
    expect(server).toContain('retryDeliveredSettlements');
  });
  it('uses one transaction to deliver the result and its settlement checkpoint',async()=>{
    const rpc=vi.fn(async()=>({error:null}));
    await completeDeliveredAction({rpc},{actionId:'action',accountId:'account',result:{text:'result'},reservationId:'reservation',credits:0.5,completeCostUsd:0.001});
    expect(rpc).toHaveBeenCalledWith('coden_billing_complete_action',expect.objectContaining({p_action_id:'action',p_reservation_id:'reservation',p_credits:0.5}));
    await expect(completeDeliveredAction({rpc:async()=>({error:{code:'XX000'}})},{actionId:'action',accountId:'account',result:{text:'result'}})).rejects.toBeInstanceOf(BillingLedgerUnavailableError);
  });
  it('pauses new paid work without pretending credits have run out',()=>{
    vi.stubEnv('CODEN_PAID_OPERATIONS_PAUSED','1');
    try {assertPaidOperationsAvailable();throw new Error('must stop');}
    catch(error:any){expect(error.diagnosticCode).toBe('PAID_OPERATIONS_PAUSED');expect(error.status).toBe(503);}
    vi.stubEnv('CODEN_PAID_OPERATIONS_PAUSED','0');expect(()=>assertPaidOperationsAvailable()).not.toThrow();
  });
  it('keeps media on the atomic ledger without changing the existing media estimate',()=>{
    const server=readFileSync(new URL('../../server.ts',import.meta.url),'utf8');
    const media=server.slice(server.indexOf("app.post('/api/projects/:id/media/generate'"),server.indexOf("app.post('/api/import/prepare'"));
    expect(media.indexOf('mediaReservation=await reserveUnifiedUsage')).toBeLessThan(media.indexOf('await falMediaGateway.generate'));
    expect(media).not.toMatch(/helpers\.(updateWallet|addLedger)|FALLBACK_WALLET_CREDITS/);
    expect(media).toContain('credits:estimatedCredits');expect(media).toContain('await completeDeliveredAction');
  });
});
