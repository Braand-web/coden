/** Public price normalization for the existing dated provider_cost_catalog. */
import { createHash } from 'node:crypto';
import type { CatalogModel } from './openrouter-capabilities.ts';
const keys = ['prompt','completion','request','image','web_search','internal_reasoning','input_cache_read','input_cache_write'] as const;
const conditions = ['min_prompt_tokens','utc_start','utc_end','utc_days'] as const;
export function modelPriceSnapshot(model: CatalogModel) {
  const raw = model.pricing as Record<string, unknown> | undefined;
  const numericPrices = (value: Record<string, unknown>) => Object.fromEntries(keys.filter(key=>(typeof value[key]==='number'||typeof value[key]==='string') && String(value[key]).trim()!=='' && Number.isFinite(Number(value[key])) && Number(value[key])>=0).map(key=>[key,String(value[key])]));
  const pricing: Record<string, unknown> = numericPrices(raw || {});
  if(!Object.keys(pricing).length) return null;
  if (Array.isArray(raw?.overrides)) {
    pricing.overrides = raw.overrides.slice(0,100).filter(value=>value && typeof value==='object').map(value=>{
      const row=value as Record<string, unknown>;
      const result: Record<string, unknown> = numericPrices(row);
      for (const key of conditions) {
        if (key==='utc_days' && Array.isArray(row[key])) result[key]=row[key].filter(day=>typeof day==='string' && /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(day));
        else if (key!=='utc_days' && Number.isInteger(row[key]) && Number(row[key])>=0) result[key]=row[key];
      }
      const recognized=new Set<string>([...keys,...conditions]);
      result.unsupported_condition=Object.keys(row).some(key=>!recognized.has(key));
      return result;
    });
  }
  const signature=createHash('sha256').update(JSON.stringify([model.id,pricing])).digest('hex');
  return { signature,model:model.id,pricing,source:'https://openrouter.ai/api/v1/models' };
}
