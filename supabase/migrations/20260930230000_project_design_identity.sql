-- The look chosen for a project (accent hue, direction, mode), remembered so that a person's next project can look
-- different from their recent ones, and so a project's own hue never changes once chosen. Additive and nullable:
-- projects created before have none, and the code reads its absence as "no identity yet".
alter table public.projects add column if not exists design_identity jsonb;
