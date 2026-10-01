-- Template apps: a template may be a complete app (its files live in the repository, versioned with the code) instead of a brief.
-- Additive: two nullable-by-default columns on the Community's own table.
alter table public.community_templates add column if not exists kind text not null default 'brief' check (kind in ('brief', 'app'));
alter table public.community_templates add column if not exists preview_url text;
