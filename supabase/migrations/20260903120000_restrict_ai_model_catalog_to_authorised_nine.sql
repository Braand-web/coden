-- Restrict the catalogue to the nine authorised models.
--
-- Written as a new migration rather than an edit to the historical seeds: those
-- have already run against production, and rewriting an applied migration
-- desynchronises every environment that recorded its checksum. History says
-- what happened; this says what is true now.
--
-- Retired models are disabled, not deleted. Existing projects carry a model_id
-- foreign key, and removing the row would orphan them — a project generated
-- last month should still say which model built it, even though nothing may
-- select that model again.

update public.ai_model_catalog
set is_allowed = false, is_available = false, updated_at = now()
where openrouter_model_id not in (
  'google/gemini-3.8-flash:batch',
  'openai/gpt-5.6-luna-pro',
  'moonshotai/kimi-k3',
  'openai/gpt-5.6-terra-pro',
  'anthropic/claude-sonnet-5',
  'x-ai/grok-4.6',
  'openai/gpt-5.6-sol-pro',
  'anthropic/claude-opus-5',
  'anthropic/claude-fable-5.1:batch'
);

insert into public.ai_model_catalog (
  openrouter_model_id, display_name, provider, tier, force_types, speed,
  cost_estimate_tier, is_allowed, is_available, max_context_tokens, updated_at
) values
  ('google/gemini-3.8-flash:batch', 'Gemini 3.8 Flash', 'google', 'Economy', array['text','code','vision','audio','video'], 'moderate', 'low', true, true, 1048576, now()),
  ('openai/gpt-5.6-luna-pro', 'Luna Pro', 'openai', 'Economy', array['text','code','vision'], 'fast', 'low', true, true, 1050000, now()),
  ('moonshotai/kimi-k3', 'Kimi K3', 'moonshot', 'Standard', array['text','code'], 'moderate', 'low', true, true, 262144, now()),
  ('openai/gpt-5.6-terra-pro', 'Terra Pro', 'openai', 'Standard', array['text','code','vision'], 'moderate', 'medium', true, true, 1050000, now()),
  ('anthropic/claude-sonnet-5', 'Sonnet 5', 'anthropic', 'Pro', array['text','code','vision'], 'moderate', 'medium', true, true, 1000000, now()),
  ('x-ai/grok-4.6', 'Grok 4.6', 'xai', 'Pro', array['text','code','vision'], 'moderate', 'medium', true, true, 500000, now()),
  ('openai/gpt-5.6-sol-pro', 'Sol Pro', 'openai', 'Premium', array['text','code','vision'], 'slow', 'high', true, true, 1050000, now()),
  ('anthropic/claude-opus-5', 'Opus 5', 'anthropic', 'Premium', array['text','code','vision'], 'slow', 'high', true, true, 1000000, now()),
  ('anthropic/claude-fable-5.1:batch', 'Fable 5.1', 'anthropic', 'Premium', array['text','code','vision'], 'slow', 'high', true, true, 1000000, now())
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

-- Prices in USD per token, matching src/config/ai-models.ts. The two figures
-- have to agree: the catalogue bills from here and the router chooses from
-- there, so a divergence means the cheapest model on paper is not the cheapest
-- on the invoice.
insert into public.ai_model_pricing (
  model_id, input_token_cost_usd, output_token_cost_usd, updated_at
) values
  ('google/gemini-3.8-flash:batch', 0.00000019, 0.00000094, now()),
  ('openai/gpt-5.6-luna-pro', 0.00000030, 0.00000180, now()),
  ('moonshotai/kimi-k3', 0.00000060, 0.00000250, now()),
  ('openai/gpt-5.6-terra-pro', 0.00000200, 0.00001200, now()),
  ('anthropic/claude-sonnet-5', 0.00000200, 0.00001000, now()),
  ('x-ai/grok-4.6', 0.00000200, 0.00000600, now()),
  ('openai/gpt-5.6-sol-pro', 0.00000250, 0.00001250, now()),
  ('anthropic/claude-opus-5', 0.00000500, 0.00002500, now()),
  ('anthropic/claude-fable-5.1:batch', 0.00000500, 0.00002500, now())
on conflict (model_id) do update set
  input_token_cost_usd = excluded.input_token_cost_usd,
  output_token_cost_usd = excluded.output_token_cost_usd,
  updated_at = now();
