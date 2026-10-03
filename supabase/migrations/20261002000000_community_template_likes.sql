-- Template likes are stored separately from project-listing likes. The only write path is the authenticated server API;
-- RLS remains enabled with no browser policies, matching the other private Community tables.
alter table public.community_templates
  add column if not exists like_count integer not null default 0 check (like_count >= 0);

create table if not exists public.community_template_likes (
  template_slug text not null references public.community_templates(slug) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (template_slug, user_id)
);
create index if not exists community_template_likes_recent_idx
  on public.community_template_likes (template_slug, created_at desc);

alter table public.community_template_likes enable row level security;
revoke all on table public.community_template_likes from public, anon, authenticated;
grant select, insert, delete on table public.community_template_likes to service_role;

-- Keep counters transactionally correct, including if a template or like is removed by maintenance.
update public.community_templates as template
set like_count = (
  select count(*)::integer
  from public.community_template_likes as likes
  where likes.template_slug = template.slug
)
where template.like_count is distinct from (
  select count(*)::integer
  from public.community_template_likes as likes
  where likes.template_slug = template.slug
);

create or replace function public.sync_community_template_like_count()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    update public.community_templates as template
    set like_count = template.like_count + 1
    where template.slug = new.template_slug;
    return new;
  end if;

  update public.community_templates as template
  set like_count = greatest(template.like_count - 1, 0)
  where template.slug = old.template_slug;
  return old;
end;
$$;

drop trigger if exists community_template_likes_sync_count on public.community_template_likes;
create trigger community_template_likes_sync_count
  after insert or delete on public.community_template_likes
  for each row execute function public.sync_community_template_like_count();

notify pgrst, 'reload schema';
