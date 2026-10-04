import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BILLING_SETTLEMENT_CURRENCY, priceFor } from '../config/billing-v2';
import { SaspayService } from './billing-service';

const price = priceFor('pro', 100, 'monthly');
const intent = {
  id: 'intent-a', account_id: 'account-a', kind: 'subscription', plan_key: 'pro',
  credit_tier: 100, billing_interval: 'monthly', amount: price.amount,
  currency: BILLING_SETTLEMENT_CURRENCY, price_version_id: price.id,
  checkout_url: 'https://checkout.example.test/a', status: 'pending',
  expires_at: '2099-01-01T00:00:00.000Z',
};

function fakeDatabase(existing: Record<string, unknown> = intent, failures: Record<string, string> = {}) {
  const writes: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const database = {
    from(table: string) {
      let operation = 'select';
      let patch: Record<string, unknown> = {};
      const response = () => ({
        data: operation === 'select' && table === 'billing_checkout_intents' ? existing : null,
        error: failures[`${table}:${operation}`] ? { message: failures[`${table}:${operation}`], code: 'XX000' } : null,
      });
      const query: any = {
        select: () => query, eq: () => query, neq: () => query,
        maybeSingle: async () => response(),
        upsert: () => { operation = 'upsert'; return query; },
        insert: () => { operation = 'insert'; return query; },
        update: (value: Record<string, unknown>) => {
          operation = 'update'; patch = value; writes.push({ table, patch }); return query;
        },
        then: (resolve: any, reject: any) => Promise.resolve(response()).then(resolve, reject),
      };
      return query;
    },
    rpc: vi.fn(async () => ({ data: 'grant-id', error: null })),
  };
  return { database, writes };
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('checkout idempotency authorization', () => {
  const retry = (existing = intent, accountId = 'account-a', credits = 100, failures: Record<string, string> = {}) => {
    const { database } = fakeDatabase(existing, failures);
    return new SaspayService(database).createSubscriptionCheckout(
      accountId, 'buyer@example.test', 'pro', 'https://coden.fun/dashboard.html', '', 'monthly', credits, 'shared-request-key',
    );
  };
  it('reuses only the same account and purchase', async () => {
    await expect(retry()).resolves.toBe(intent.checkout_url);
  });
  it('never returns another account checkout URL', async () => {
    await expect(retry(intent, 'account-b')).rejects.toThrow(/checkout/i);
  });
  it('rejects a retry with a different tier', async () => {
    await expect(retry(intent, 'account-a', 200)).rejects.toThrow(/checkout/i);
  });
  it('does not reuse an expired payment session', async () => {
    await expect(retry({ ...intent, expires_at: '2020-01-01T00:00:00Z' })).rejects.toThrow(/checkout/i);
  });
  it('fails closed if the idempotency lookup fails', async () => {
    await expect(retry(intent, 'account-a', 100, { 'billing_checkout_intents:select': 'database unavailable' })).rejects.toThrow(/lookup/i);
  });
});

describe('paid webhook persistence', () => {
  it.each([
    {status:'pending'}, {amount:price.amount+500}, {currency:'USD'}, {id:'another-transaction'}, {transaction_type:'RETRAIT'}, {flow_direction:'OUTBOUND'},
  ])('rejects inconsistent provider confirmation %j before any grant', async patch => {
    vi.stubEnv('SASPAY_API_KEY', 'sk_test_fixture_only');
    const {database}=fakeDatabase({...intent,kind:'topup'});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({id:'tx-test',status:'success',transaction_type:'PAIEMENT',flow_direction:'INBOUND',amount:price.amount,currency:BILLING_SETTLEMENT_CURRENCY,metadata:{coden_intent_id:intent.id},...patch}),{status:200})));
    const raw=JSON.stringify({event:'transaction.success',data:{id:'tx-test',amount:price.amount,currency:BILLING_SETTLEMENT_CURRENCY}});
    const timestamp=String(Math.floor(Date.now()/1000));
    const signature=createHmac('sha256','fixture-secret').update(`${timestamp}.${raw}`).digest('hex');
    await expect(new SaspayService(database).handleWebhook(raw,signature,timestamp,'','fixture-secret')).rejects.toThrow();
    expect(database.rpc).not.toHaveBeenCalled();
  });
  it('rejects an invalid signature before contacting the provider or ledger', async () => {
    const {database}=fakeDatabase();
    const fetch=vi.fn(); vi.stubGlobal('fetch',fetch);
    await expect(new SaspayService(database).handleWebhook('{}','invalid',String(Math.floor(Date.now()/1000)),'','fixture-secret')).rejects.toThrow(/signature/i);
    expect(fetch).not.toHaveBeenCalled(); expect(database.rpc).not.toHaveBeenCalled();
  });
  it('never acknowledges a payment if its durable intent update failed', async () => {
    vi.stubEnv('SASPAY_API_KEY', 'sk_test_fixture_only');
    const paid = { ...intent, kind: 'topup', status: 'pending' };
    const { database, writes } = fakeDatabase(paid, { 'billing_checkout_intents:update': 'database unavailable' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'tx-test', status: 'success', transaction_type:'PAIEMENT', flow_direction:'INBOUND', amount: price.amount, currency: BILLING_SETTLEMENT_CURRENCY,
      metadata: { coden_intent_id: intent.id },
    }), { status: 200 })));
    const raw = JSON.stringify({ event: 'transaction.success', data: { id: 'tx-test' } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const secret = 'webhook_test_fixture';
    const signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
    await expect(new SaspayService(database).handleWebhook(raw, signature, timestamp, '', secret)).rejects.toThrow(/persistence/i);
    expect(writes.some(write => write.table === 'provider_webhook_events' && write.patch.status === 'processed')).toBe(false);
    expect(database.rpc).toHaveBeenCalledTimes(1);
  });
});
