-- Read-only monitoring. Aggregate only: no prompts, emails or source code.
-- Set both bounds to compare cohorts before/after a deployment. A completed
-- run is NOT a measured end-to-end task success.
WITH bounds AS (
  SELECT now() - interval '3 days' AS since, now() AS until
), runs AS (
  SELECT r.* FROM public.agent_runs r, bounds b
  WHERE r.created_at >= b.since AND r.created_at < b.until
), turns AS (
  SELECT t.* FROM public.agent_turns t, bounds b
  WHERE t.created_at >= b.since AND t.created_at < b.until
), first_event AS (
  SELECT t.id, extract(epoch FROM (min(e.created_at) - t.created_at))*1000 AS ms
  FROM turns t JOIN public.agent_harness_events e ON e.turn_id=t.id AND e.visibility='public'
  GROUP BY t.id,t.created_at
)
SELECT jsonb_build_object(
  'runs', (SELECT count(*) FROM runs),
  'failed_runs', (SELECT count(*) FROM runs WHERE status='failed'),
  'diagnostics', (SELECT jsonb_object_agg(code,n) FROM (SELECT coalesce(diagnostic_code,'none') code,count(*) n FROM runs GROUP BY 1) d),
  'run_turn_link_coverage', (SELECT count(*) FROM runs WHERE context_summary->>'harness_turn_id' IS NOT NULL),
  'impossible_completion_dates', (SELECT count(*) FROM runs WHERE completed_at < created_at),
  'cost_coverage', (SELECT count(real_cost_usd) FROM runs),
  'known_cost_usd', (SELECT sum(real_cost_usd) FROM runs),
  'duration_coverage', (SELECT count(duration_ms) FROM runs),
  'duration_p50_ms_all_intents', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) FROM runs WHERE duration_ms >= 0),
  'resolved_action_coverage', (SELECT count(resolved_action) FROM turns),
  'turns', (SELECT count(*) FROM turns),
  'public_event_coverage', (SELECT count(*) FROM first_event),
  'first_public_event_p50_ms_not_client_paint', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) FROM first_event WHERE ms >= 0),
  'verification_status', (SELECT jsonb_object_agg(state,n) FROM (SELECT coalesce(verification_status,'unknown') state,count(*) n FROM runs GROUP BY 1) v)
) AS quality_metrics;
