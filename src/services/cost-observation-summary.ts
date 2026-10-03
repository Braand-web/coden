import type { ProviderCostObservation } from './cost-observability.ts';
/** Unknown is not zero; provider observations and billing usage are never summed together. */
export function costObservationSummary(rows: ProviderCostObservation[]) {
  const byMode = new Map<string, { mode: string; calls: number; succeeded: number; knownCostUsd: number; unknownCosts: number; promptTokens: number; cachedTokens: number; cacheMeasuredCalls: number; cacheMeasuredPromptTokens: number; invalidCacheCalls: number; incompleteCacheCalls: number }>();
  for (const row of rows) {
    const mode=row.mode||'unknown';
    const b=byMode.get(mode)||{mode,calls:0,succeeded:0,knownCostUsd:0,unknownCosts:0,promptTokens:0,cachedTokens:0,cacheMeasuredCalls:0,cacheMeasuredPromptTokens:0,invalidCacheCalls:0,incompleteCacheCalls:0};
    b.calls++; b.succeeded+=Number(row.result==='succeeded');
    if(row.cost_usd===null) b.unknownCosts++; else b.knownCostUsd+=Number(row.cost_usd);
    b.promptTokens+=Number(row.input_tokens||0);
    if(row.cached_read_tokens===null || row.input_tokens===null) b.incompleteCacheCalls++;
    else if(!Number.isFinite(row.cached_read_tokens) || !Number.isFinite(row.input_tokens) || row.cached_read_tokens<0 || row.input_tokens<0 || row.cached_read_tokens>row.input_tokens) b.invalidCacheCalls++;
    else { b.cacheMeasuredCalls++; b.cachedTokens+=row.cached_read_tokens; b.cacheMeasuredPromptTokens+=row.input_tokens; }
    byMode.set(mode,b);
  }
  return { calls:rows.length, missingAttribution:rows.filter(r=>!r.actor_key||!r.plan||!r.stage||!r.task_key).length,
    measuredCostCalls:rows.filter(r=>r.cost_source==='gateway').length, estimatedCostCalls:rows.filter(r=>r.cost_source==='estimated').length, unknownCostCalls:rows.filter(r=>r.cost_source==='unknown').length,
    byMode:[...byMode.values()].map(b=>({...b,cacheReadRate:b.cacheMeasuredPromptTokens>0?b.cachedTokens/b.cacheMeasuredPromptTokens:null})),
    costPerSuccessfulTask:null, reason:'task_outcome_join_required; calls_are_not_tasks',
  };
}
