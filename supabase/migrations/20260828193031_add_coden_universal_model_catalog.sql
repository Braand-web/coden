-- Add the universal Coden worker models without rewriting the historical seed.
-- The obsolete unpinned DeepSeek alias is disabled so new runs cannot select it.

update public.ai_model_catalog
set is_allowed = false, is_available = false, updated_at = now()
where openrouter_model_id = 'deepseek/deepseek-v4-pro';

insert into public.ai_model_catalog (
  openrouter_model_id, display_name, provider, tier, force_types, speed,
  cost_estimate_tier, is_allowed, is_available, max_context_tokens, updated_at
) values
  ('deepseek/deepseek-v4-pro-0813', 'DeepSeek V4 Pro 0813', 'deepseek', 'Economy', array['text','code'], 'moderate', 'low', true, true, 1048576, now()),
  ('qwen/qwen3.8-27b', 'Qwen3.8 27B', 'qwen', 'Standard', array['text','code','vision','video'], 'moderate', 'low', true, true, 1000000, now()),
  ('z-ai/glm-5.3', 'GLM-5.3', 'zai', 'Standard', array['text','code'], 'moderate', 'medium', true, true, 1048576, now())
on conflict (openrouter_model_id) do update set
  display_name = excluded.display_name,
  provider = excluded.provider,
  tier = excluded.tier,
  force_types = excluded.force_types,
  speed = excluded.speed,
  cost_estimate_tier = excluded.cost_estimate_tier,
  is_allowed = excluded.is_allowed,
  is_available = excluded.is_available,
  max_context_tokens = excluded.max_context_tokens,
  updated_at = now();

insert into public.ai_model_pricing (
  model_id, input_token_cost_usd, output_token_cost_usd, updated_at
) values
  ('deepseek/deepseek-v4-pro-0813', 0.00000066, 0.00000198, now()),
  ('qwen/qwen3.8-27b', 0.000000425, 0.00000255, now()),
  ('z-ai/glm-5.3', 0.0000014, 0.0000044, now())
on conflict (model_id) do update set
  input_token_cost_usd = excluded.input_token_cost_usd,
  output_token_cost_usd = excluded.output_token_cost_usd,
  updated_at = now();
