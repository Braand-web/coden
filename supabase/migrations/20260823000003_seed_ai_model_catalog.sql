-- Canonical OpenRouter model allowlist verified against the live model catalog.

insert into public.ai_model_catalog (
  openrouter_model_id, display_name, provider, tier, force_types, speed,
  cost_estimate_tier, is_allowed, is_available, max_context_tokens, updated_at
) values
  ('openai/gpt-5.6-luna', 'Luna', 'openai', 'Economy', array['text','code','vision'], 'fast', 'low', true, true, 1050000, now()),
  ('google/gemini-3.7-flash', 'Gemini 3.7 Flash', 'google', 'Economy', array['text','code','vision','audio','video'], 'fast', 'low', true, true, 1048576, now()),
  ('deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', 'Economy', array['text','code'], 'moderate', 'low', true, true, 1048576, now()),
  ('openai/gpt-5.6-terra', 'Terra', 'openai', 'Standard', array['text','code','vision'], 'moderate', 'medium', true, true, 1050000, now()),
  ('anthropic/claude-sonnet-5', 'Sonnet 5', 'anthropic', 'Pro', array['text','code','vision'], 'moderate', 'medium', true, true, 1000000, now()),
  ('x-ai/grok-4.6', 'Grok 4.6', 'xai', 'Pro', array['text','code','vision'], 'moderate', 'medium', true, true, 500000, now()),
  ('openai/gpt-5.6-sol', 'Sol', 'openai', 'Premium', array['text','code','vision'], 'slow', 'high', true, true, 1050000, now()),
  ('anthropic/claude-opus-5', 'Opus 5', 'anthropic', 'Premium', array['text','code','vision'], 'slow', 'high', true, true, 1000000, now()),
  ('anthropic/claude-fable-5', 'Fable 5', 'anthropic', 'Premium', array['text','code','vision'], 'slow', 'very high', true, true, 1000000, now())
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
  ('openai/gpt-5.6-luna', 0.0000002, 0.0000012, now()),
  ('google/gemini-3.7-flash', 0.000000375, 0.000001875, now()),
  ('deepseek/deepseek-v4-pro', 0.000000396894, 0.000000793788, now()),
  ('openai/gpt-5.6-terra', 0.000002, 0.000012, now()),
  ('anthropic/claude-sonnet-5', 0.000002, 0.00001, now()),
  ('x-ai/grok-4.6', 0.000002, 0.000006, now()),
  ('openai/gpt-5.6-sol', 0.000002, 0.00001, now()),
  ('anthropic/claude-opus-5', 0.000005, 0.000025, now()),
  ('anthropic/claude-fable-5', 0.00001, 0.00005, now())
on conflict (model_id) do update set
  input_token_cost_usd = excluded.input_token_cost_usd,
  output_token_cost_usd = excluded.output_token_cost_usd,
  updated_at = now();

