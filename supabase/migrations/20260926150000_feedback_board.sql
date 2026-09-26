-- Suggestions : idées et bugs publiés par les utilisateurs connectés, votes,
-- réponses, signalements, notifications de changement de statut.
--
-- Tout passe par le serveur (clé de service) : RLS activé et aucun droit
-- pour anon ni authenticated. Les compteurs sont tenus par des triggers,
-- jamais par le client.

create table if not exists public.feedback_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null default 'Membre Coden',
  type text not null check (type in ('feature', 'bug')),
  title text not null check (char_length(title) between 8 and 120),
  body text not null default '' check (char_length(body) <= 5000),
  -- Un bug de sécurité n'est visible que de son auteur et de l'équipe.
  private boolean not null default false,
  status text not null default 'new' check (status in ('new', 'under_review', 'planned', 'in_progress', 'done', 'declined', 'duplicate')),
  duplicate_of uuid references public.feedback_posts(id) on delete set null,
  attachment_id uuid,
  attachment_path text,
  vote_count integer not null default 0 check (vote_count >= 0),
  paid_vote_count integer not null default 0 check (paid_vote_count >= 0),
  comment_count integer not null default 0 check (comment_count >= 0),
  report_count integer not null default 0 check (report_count >= 0),
  pinned boolean not null default false,
  hidden_at timestamptz,
  hidden_by text,
  status_changed_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (duplicate_of is null or duplicate_of <> id)
);
create index if not exists feedback_posts_activity_idx on public.feedback_posts (last_activity_at desc) where hidden_at is null;
create index if not exists feedback_posts_author_idx on public.feedback_posts (author_id, created_at desc);

create table if not exists public.feedback_votes (
  post_id uuid not null references public.feedback_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_paid boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists feedback_votes_user_idx on public.feedback_votes (user_id);

create table if not exists public.feedback_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feedback_posts(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null default 'Membre Coden',
  body text not null check (char_length(body) between 1 and 3000),
  is_team boolean not null default false,
  pinned boolean not null default false,
  hidden_at timestamptz,
  hidden_by text,
  created_at timestamptz not null default now()
);
create index if not exists feedback_comments_post_idx on public.feedback_comments (post_id, created_at);

create table if not exists public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feedback_posts(id) on delete cascade,
  comment_id uuid references public.feedback_comments(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 300),
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now()
);
create unique index if not exists feedback_reports_once on public.feedback_reports (reporter_id, post_id, coalesce(comment_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.feedback_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.feedback_posts(id) on delete cascade,
  status text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, post_id, status)
);
create index if not exists feedback_notifications_unread_idx on public.feedback_notifications (user_id, created_at desc) where read_at is null;

alter table public.feedback_posts enable row level security;
alter table public.feedback_votes enable row level security;
alter table public.feedback_comments enable row level security;
alter table public.feedback_reports enable row level security;
alter table public.feedback_notifications enable row level security;
revoke all on public.feedback_posts, public.feedback_votes, public.feedback_comments, public.feedback_reports, public.feedback_notifications from anon, authenticated;

-- Compteurs : votes (dont votants payants), réponses visibles, signalements.
create or replace function public.coden_feedback_vote_counter()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.feedback_posts
       set vote_count = vote_count + 1,
           paid_vote_count = paid_vote_count + case when new.is_paid then 1 else 0 end,
           last_activity_at = now()
     where id = new.post_id;
    return new;
  end if;
  update public.feedback_posts
     set vote_count = greatest(0, vote_count - 1),
         paid_vote_count = greatest(0, paid_vote_count - case when old.is_paid then 1 else 0 end)
   where id = old.post_id;
  return old;
end;
$$;
drop trigger if exists feedback_votes_counter on public.feedback_votes;
create trigger feedback_votes_counter after insert or delete on public.feedback_votes
  for each row execute function public.coden_feedback_vote_counter();

create or replace function public.coden_feedback_comment_counter()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  delta integer := 0;
  target uuid := coalesce(new.post_id, old.post_id);
begin
  if tg_op = 'INSERT' then
    delta := case when new.hidden_at is null then 1 else 0 end;
  elsif tg_op = 'DELETE' then
    delta := case when old.hidden_at is null then -1 else 0 end;
  else
    delta := (case when new.hidden_at is null then 1 else 0 end) - (case when old.hidden_at is null then 1 else 0 end);
  end if;
  if delta <> 0 then
    update public.feedback_posts
       set comment_count = greatest(0, comment_count + delta),
           last_activity_at = case when delta > 0 and tg_op = 'INSERT' then now() else last_activity_at end
     where id = target;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists feedback_comments_counter on public.feedback_comments;
create trigger feedback_comments_counter after insert or update of hidden_at or delete on public.feedback_comments
  for each row execute function public.coden_feedback_comment_counter();

create or replace function public.coden_feedback_report_counter()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.feedback_posts set report_count = report_count + 1 where id = new.post_id;
  elsif old.resolved_at is null and new.resolved_at is not null then
    update public.feedback_posts set report_count = greatest(0, report_count - 1) where id = new.post_id;
  end if;
  return new;
end;
$$;
drop trigger if exists feedback_reports_counter on public.feedback_reports;
create trigger feedback_reports_counter after insert or update of resolved_at on public.feedback_reports
  for each row execute function public.coden_feedback_report_counter();

-- Fusion d'un doublon : ses votes rejoignent la suggestion cible (un vote
-- par personne), puis il passe au statut « doublon ».
create or replace function public.coden_feedback_merge(p_source uuid, p_target uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved integer := 0;
begin
  if p_source = p_target then raise exception 'Cannot merge a suggestion into itself'; end if;
  perform 1 from public.feedback_posts where id in (p_source, p_target) for update;
  if (select count(*) from public.feedback_posts where id in (p_source, p_target)) <> 2 then
    raise exception 'Suggestion not found';
  end if;
  if exists (select 1 from public.feedback_posts where id = p_target and (status = 'duplicate' or hidden_at is not null)) then
    raise exception 'Target is not open';
  end if;
  insert into public.feedback_votes (post_id, user_id, is_paid, created_at)
    select p_target, user_id, is_paid, created_at from public.feedback_votes where post_id = p_source
    on conflict (post_id, user_id) do nothing;
  get diagnostics moved = row_count;
  delete from public.feedback_votes where post_id = p_source;
  update public.feedback_posts
     set status = 'duplicate', duplicate_of = p_target, status_changed_at = now(), updated_at = now()
   where id = p_source;
  return moved;
end;
$$;
revoke all on function public.coden_feedback_merge(uuid, uuid) from public, anon, authenticated;
grant execute on function public.coden_feedback_merge(uuid, uuid) to service_role;
revoke all on function public.coden_feedback_vote_counter() from public, anon, authenticated;
revoke all on function public.coden_feedback_comment_counter() from public, anon, authenticated;
revoke all on function public.coden_feedback_report_counter() from public, anon, authenticated;
