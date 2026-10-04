/** Read-only, bounded audit. No model generation, RPC, Auth-user listing or writes. */
import { createHmac, randomBytes } from 'node:crypto';
import { decryptSecret } from '../src/lib/secret-box.ts';

const until = new Date().toISOString();
const since = process.env.CODEN_COST_AUDIT_SINCE || '2026-09-01T00:00:00.000Z';
const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
if (new URL(base).hostname !== 'ftmbiocvslxctldfihcp.supabase.co') throw new Error('Central Coden project required');
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!secret) throw new Error('Server-only audit credential missing');
const salt = process.env.CODEN_COST_AUDIT_SALT || randomBytes(32).toString('hex');
const pseudo = value => createHmac('sha256', salt).update(String(value || 'unattributed')).digest('hex').slice(0, 16);
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const sum = (rows, key) => rows.reduce((total, row) => total + num(row[key]), 0);
const countBy = (rows, key) => Object.fromEntries([...new Set(rows.map(row => String(row[key] ?? 'unknown')))].map(value => [value, rows.filter(row => String(row[key] ?? 'unknown') === value).length]));
const quantile = (values, q) => { if (!values.length) return null; const sorted = [...values].sort((a,b) => a-b); return sorted[Math.ceil(q * sorted.length) - 1]; };
let requests = 0;
const coverage = {};
async function get(url, headers = {}) {
  if (++requests > 100) throw new Error('Audit read-request ceiling reached');
  const result = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!result.ok) return { error: `HTTP_${result.status}`, status: result.status };
  return { data: await result.json(), count: result.headers.get('content-range') };
}
const auth = { apikey: secret, Authorization: `Bearer ${secret}` };
const schemaResult = await get(`${base}/rest/v1/`, { ...auth, Accept: 'application/openapi+json' });
const definitions = schemaResult.data?.definitions || {};
async function rows(table, wanted, timeField = 'created_at') {
  const properties = definitions[table]?.properties;
  const available = properties ? wanted.filter(column => properties[column] || column.includes(':')) : wanted;
  const total = [];
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const params = new URLSearchParams({ select: available.join(','), limit: '1000', offset: String(offset) });
    if (timeField && (!properties || properties[timeField])) {
      params.append(timeField, `gte.${since}`); params.append(timeField, `lt.${until}`);
      params.set('order', `${timeField}.asc,id.asc`);
    }
    const r = await get(`${base}/rest/v1/${table}?${params}`, { ...auth, Prefer: 'count=exact' });
    if (r.error) { coverage[table] = { status: r.error, rows: total.length }; return total; }
    total.push(...r.data);
    const expected = Number(r.count?.split('/')[1]);
    coverage[table] = { status: 'read', rows: total.length, total: Number.isFinite(expected) ? expected : null, complete: Number.isFinite(expected) ? total.length >= expected : r.data.length < 1000 };
    if (r.data.length < 1000 || (Number.isFinite(expected) && total.length >= expected)) break;
  }
  return total;
}
const events = await rows('usage_events', ['id','account_id','organization_id','run_id','project_id','model','model_used','category','resource','provider','provider_cost_usd','complete_cost_usd','cost_usd','allocated_platform_cost_usd','created_at','prompt_tokens:provider_payload->prompt_tokens','completion_tokens:provider_payload->completion_tokens','reasoning_tokens:provider_payload->reasoning_tokens','cached_tokens:provider_payload->cached_tokens']);
const settlements = await rows('usage_settlements', ['id','usage_event_id','credits_charged','realized_revenue_usd','complete_cost_usd','created_at']);
const checkouts = await rows('billing_checkout_intents', ['id','account_id','kind','plan_key','credit_tier','billing_interval','amount','currency','status','paid_at','created_at']);
const subscriptions = await rows('billing_subscriptions_v2', ['id','account_id','plan_id','credit_tier','billing_interval','status','monthly_net_revenue_usd','created_at'], null);
const runs = await rows('agent_runs', ['id','intent','mode','status','model_id','diagnostic_code','duration_ms','created_at','completed_at','cancelled_at']);
const routing = await rows('model_routing_events', ['id','kind','run_id','task','mode','policy','arm','to_model','ok','cost_usd','latency_ms','prompt_tokens','cached_tokens','created_at']);
const projects = await rows('projects', ['id','created_at']);
const pricing = await get('https://coden.fun/api/billing/plans');
const health = await get('https://coden.fun/api/health');
const catalogue = await get('https://openrouter.ai/api/v1/models');
const routerKey = decryptSecret(process.env.OPENROUTER_API_KEY_ENCRYPTED, process.env.CODEN_SECRETS_KEY, { quiet: true }) || process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_KEY || process.env.OPENROUTER_TOKEN;
const keyResult = routerKey ? await get('https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${routerKey}` }) : { error: 'credential_unavailable' };
const creditsResult = routerKey ? await get('https://openrouter.ai/api/v1/credits', { Authorization: `Bearer ${routerKey}` }) : { error: 'credential_unavailable' };
const modelIds = new Set(events.map(row => row.model || row.model_used).filter(Boolean));
const cost = row => num(row.complete_cost_usd) || num(row.provider_cost_usd) || num(row.cost_usd);
const byModel = [...modelIds].map(model => { const subset = events.filter(row => (row.model || row.model_used) === model); return { model, events: subset.length, ledgerCostUsd: subset.reduce((s,r)=>s+cost(r),0), promptTokens: sum(subset,'prompt_tokens'), completionTokens: sum(subset,'completion_tokens'), reasoningTokens: sum(subset,'reasoning_tokens'), cachedTokens: sum(subset,'cached_tokens') }; }).sort((a,b)=>b.ledgerCostUsd-a.ledgerCostUsd);
const users = new Map();
for (const event of events) { const key = pseudo(event.account_id || event.organization_id); users.set(key, (users.get(key)||0)+cost(event)); }
const paid = checkouts.filter(row=>row.status==='paid');
const report = {
  schemaVersion: 1, capturedAt: until, window: { since, until }, ceiling: { modelCalls: 0, maxReadRequests: 100, usedReadRequests: requests, maxRowsPerTable: 50_000 },
  coverage, tableColumns: Object.fromEntries(['usage_events','usage_settlements','billing_pricing_versions'].map(t=>[t, Object.keys(definitions[t]?.properties || {})])),
  ledger: { events: events.length, providerCostUsd: sum(events,'provider_cost_usd'), completeCostUsd: sum(events,'complete_cost_usd'), effectiveCostUsd: events.reduce((s,r)=>s+cost(r),0), platformAllocationUsd: sum(events,'allocated_platform_cost_usd'), chargedCredits: sum(settlements,'credits_charged'), allocatedRevenueUsd: sum(settlements,'realized_revenue_usd'), byProvider: countBy(events,'provider'), byCategory: countBy(events,'category'), byModel, missingRunId: events.filter(row=>!row.run_id).length, withCacheMeasurement: events.filter(row=>row.cached_tokens!=null).length, withReasoningMeasurement: events.filter(row=>row.reasoning_tokens!=null).length },
  revenue: { checkoutStatuses: countBy(checkouts,'status'), paidCheckouts: paid.length, paidByCurrency: Object.fromEntries([...new Set(paid.map(r=>r.currency))].map(currency=>[currency,sum(paid.filter(r=>r.currency===currency),'amount')])), subscriptionStatuses: countBy(subscriptions,'status'), paidSubscriptionsByPlan: countBy(subscriptions.filter(r=>['active','trialing'].includes(r.status)),'plan_id'), providerFeesKnown: false, taxesKnown: false, invoiceReconciled: false },
  userDistribution: { measuredAccounts: users.size, medianCostUsd: quantile([...users.values()],.5), p90CostUsd: quantile([...users.values()],.9), p99CostUsd: quantile([...users.values()],.99), largest: [...users].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([pseudonym,costUsd])=>({pseudonym,costUsd})) },
  runs: { count: runs.length, statuses: countBy(runs,'status'), byIntent: countBy(runs,'intent'), byMode: countBy(runs,'mode'), diagnostics: countBy(runs.filter(r=>r.status==='failed'),'diagnostic_code'), durationP50Ms: quantile(runs.map(r=>num(r.duration_ms)).filter(n=>n>0),.5), durationP95Ms: quantile(runs.map(r=>num(r.duration_ms)).filter(n=>n>0),.95), unmatchedUsageRuns: events.filter(r=>r.run_id&&!runs.some(run=>run.id===r.run_id)).length, runsWithUsage: new Set(events.map(r=>r.run_id).filter(Boolean)).size, routingCount: routing.length, routingByMode: countBy(routing,'mode'), newProjects: projects.length },
  openrouter: { key: keyResult.error || Object.fromEntries(['usage','usage_daily','usage_weekly','usage_monthly','byok_usage','byok_usage_monthly','limit','limit_remaining','is_free_tier'].filter(key => key in (keyResult.data?.data || {})).map(key => [key, keyResult.data.data[key]])), credits: creditsResult.error || Object.fromEntries(['total_credits','total_usage'].filter(key => key in (creditsResult.data?.data || {})).map(key => [key, creditsResult.data.data[key]])), invoiceReconciled: false },
  publicPricing: pricing.error ? pricing.error : pricing.data,
  productionHealth: health.error ? health.error : { success: health.data?.success, status: health.data?.status, version: health.data?.version },
  publicModelPrices: (catalogue.data?.data||[]).filter(m=>modelIds.has(m.id)).map(m=>({ id:m.id, pricing:m.pricing, source:'https://openrouter.ai/api/v1/models', capturedAt:until })),
};
console.log(JSON.stringify(report,null,2));
