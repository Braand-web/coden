-- Communauté: published apps shown to everyone, classed by category, plus Coden's official templates.
-- Additive only: nothing here touches an existing table. Everything is reached by the server (service role): row level
-- security is on with no policy, so the browser can never read or write these tables directly.
--
-- A listing is the *showcase* of a published project. It holds no source: the code that can be remixed lives in
-- community_listing_versions.files (a frozen copy of what was published), never in the creator's draft.

create table if not exists public.community_categories (
  slug text primary key,
  label text not null,
  position integer not null default 0,
  active boolean not null default true
);
insert into public.community_categories (slug, label, position) values
  ('site-vitrine', 'Site vitrine', 10),
  ('portfolio', 'Portfolio', 20),
  ('saas-outils', 'SaaS et outils', 30),
  ('tableau-de-bord', 'Tableau de bord', 40),
  ('e-commerce', 'E-commerce', 50),
  ('jeux', 'Jeux', 60),
  ('reservation-evenements', 'Réservation et événements', 70),
  ('blog-contenu', 'Blog et contenu', 80),
  ('education', 'Éducation', 90),
  ('autre', 'Autre', 100)
on conflict (slug) do nothing;

create table if not exists public.community_listings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  owner_id uuid not null,
  organization_id uuid,
  title text not null,
  description text not null default '',
  category text not null default 'autre' references public.community_categories(slug),
  tags text[] not null default '{}',
  -- Who the visitors see: the creator's chosen pseudonym, or « Créateur anonyme » when empty.
  creator_alias text,
  -- Why this app is (or may be) listed: free plan, automatically; paid plan, by the owner's choice.
  origin text not null default 'free_auto' check (origin in ('free_auto', 'paid_opt_in')),
  opted_in boolean not null default false,
  remixable boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'online', 'needs_fix', 'refused', 'removed_by_user', 'removed_by_moderation', 'hidden')),
  status_code text,
  status_reason text,
  -- The version visitors see: the last one that passed the checks.
  current_version_id uuid,
  public_url text,
  thumbnail_path text,
  thumbnail_alt text,
  quality_score integer check (quality_score is null or quality_score between 0 and 100),
  featured boolean not null default false,
  indexable boolean not null default false,
  view_count integer not null default 0,
  like_count integer not null default 0,
  remix_count integer not null default 0,
  report_count integer not null default 0,
  trending_score double precision not null default 0,
  content_fingerprint text,
  listed_at timestamptz,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(tags, ' '), '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C')
  ) stored
);
create index if not exists community_listings_online_recent_idx on public.community_listings (listed_at desc, id) where status = 'online';
create index if not exists community_listings_online_category_idx on public.community_listings (category, listed_at desc) where status = 'online';
create index if not exists community_listings_online_trending_idx on public.community_listings (trending_score desc, id) where status = 'online';
create index if not exists community_listings_owner_idx on public.community_listings (owner_id);
create index if not exists community_listings_status_idx on public.community_listings (status, updated_at desc);
create index if not exists community_listings_fingerprint_idx on public.community_listings (content_fingerprint) where content_fingerprint is not null;
create index if not exists community_listings_search_idx on public.community_listings using gin (search_vector);

-- One row per published version that went through the checks. `files` is the frozen copy a remix starts from.
create table if not exists public.community_listing_versions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.community_listings(id) on delete cascade,
  deployment_id uuid,
  artifact_hash text,
  public_url text,
  state text not null default 'checking' check (state in ('checking', 'passed', 'failed')),
  severity text check (severity is null or severity in ('minor', 'major', 'critical')),
  report jsonb not null default '{}'::jsonb,
  files jsonb,
  files_bytes integer not null default 0,
  thumbnail_path text,
  quality_score integer,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists community_listing_versions_listing_idx on public.community_listing_versions (listing_id, created_at desc);

create table if not exists public.community_likes (
  listing_id uuid not null references public.community_listings(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);
create index if not exists community_likes_recent_idx on public.community_likes (listing_id, created_at desc);

-- A view counts once per visitor per day. The visitor is a salted hash, never an address or an account id.
create table if not exists public.community_views (
  listing_id uuid not null references public.community_listings(id) on delete cascade,
  viewer_hash text not null,
  day date not null default current_date,
  primary key (listing_id, viewer_hash, day)
);

create table if not exists public.community_remixes (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.community_listings(id) on delete set null,
  template_id text,
  source_project_id uuid,
  new_project_id uuid references public.projects(id) on delete set null,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists community_remixes_listing_idx on public.community_remixes (listing_id, created_at desc);
create index if not exists community_remixes_user_idx on public.community_remixes (user_id, created_at desc);

create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.community_listings(id) on delete cascade,
  reporter_id uuid not null,
  reason text not null check (reason in ('illegal', 'adult', 'hate', 'scam', 'impersonation', 'copyright', 'privacy', 'spam', 'other')),
  details text,
  status text not null default 'open' check (status in ('open', 'upheld', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (listing_id, reporter_id)
);
create index if not exists community_reports_open_idx on public.community_reports (status, created_at desc);

-- The decision journal: who decided what, why, when. Written for every listing decision, by the system, a person or an admin.
create table if not exists public.community_moderation_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.community_listings(id) on delete set null,
  project_id uuid,
  actor_type text not null check (actor_type in ('system', 'user', 'admin')),
  actor_id uuid,
  event text not null,
  from_status text,
  to_status text,
  code text,
  reason text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists community_moderation_events_listing_idx on public.community_moderation_events (listing_id, created_at desc);
create index if not exists community_moderation_events_recent_idx on public.community_moderation_events (created_at desc);

-- « Contester »: a creator asks for a second look at a refusal. No manual queue is required; admins may answer.
create table if not exists public.community_appeals (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.community_listings(id) on delete cascade,
  user_id uuid not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists community_appeals_open_idx on public.community_appeals (status, created_at desc);

-- Optional public profile of a creator. Never an email or a real name unless the person typed one here.
create table if not exists public.community_profiles (
  user_id uuid primary key,
  display_name text,
  bio text,
  public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Graduated sanctions on a creator: a warning, a suspension for a while, then a ban from the Community. The app itself
-- is never affected: only its listing.
create table if not exists public.community_sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  level text not null check (level in ('warning', 'suspension', 'ban')),
  reason text,
  until timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists community_sanctions_user_idx on public.community_sanctions (user_id, created_at desc);

-- Runtime switches an admin can flip without a deploy (hide the whole Community, freeze new listings, …).
create table if not exists public.community_settings (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- Paid → free: a 14-day notice before an app that was kept private starts being listed automatically.
create table if not exists public.community_plan_notices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  organization_id uuid,
  kind text not null check (kind in ('downgrade_notice')),
  effective_at timestamptz not null,
  notified_at timestamptz,
  cancelled_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists community_plan_notices_due_idx on public.community_plan_notices (effective_at) where applied_at is null and cancelled_at is null;

-- Coden's official templates: never subject to the free / paid listing rules.
create table if not exists public.community_templates (
  slug text primary key,
  title text not null,
  description text not null default '',
  category text not null default 'autre' references public.community_categories(slug),
  brief text not null,
  version integer not null default 1,
  min_plan text not null default 'free' check (min_plan in ('free', 'pro', 'business', 'enterprise')),
  active boolean not null default true,
  design_score integer,
  tested_at timestamptz,
  use_count integer not null default 0,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.community_categories enable row level security;
alter table public.community_listings enable row level security;
alter table public.community_listing_versions enable row level security;
alter table public.community_likes enable row level security;
alter table public.community_views enable row level security;
alter table public.community_remixes enable row level security;
alter table public.community_reports enable row level security;
alter table public.community_moderation_events enable row level security;
alter table public.community_appeals enable row level security;
alter table public.community_profiles enable row level security;
alter table public.community_settings enable row level security;
alter table public.community_sanctions enable row level security;
alter table public.community_plan_notices enable row level security;
alter table public.community_templates enable row level security;
