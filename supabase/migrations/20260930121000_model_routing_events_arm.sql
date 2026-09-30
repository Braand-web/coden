-- The experiment arm a run was assigned to (see routing-experiments.ts), so the
-- dashboard can compare a candidate routing change against the control on real
-- runs: success, cost, escalations.
alter table public.model_routing_events add column if not exists arm text;
create index if not exists model_routing_events_arm_idx on public.model_routing_events (arm, created_at desc) where arm is not null;
