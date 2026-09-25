-- Preserve actionable provider failures for the publication UI and support.
-- Nullable columns keep this additive and safe for existing deployment rows.
alter table public.deployments
  add column if not exists diagnostic_code text,
  add column if not exists error_message text;
