-- Prepared locally only. Publication state is server-owned; website visitors are
-- deliberately NOT project_members and receive no Data API/editor grants.
create table public.project_publication_state (
  project_id uuid primary key references public.projects(id) on delete cascade,
  hosting_id text not null unique,
  draft jsonb not null,
  effective jsonb,
  release_id uuid,
  fingerprint text,
  enabled boolean not null default false,
  removal_pending boolean not null default false,
  generation integer not null default 0,
  updated_at timestamptz not null default now()
);
create table public.publication_snapshots (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid not null,
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  job_id text not null unique,
  snapshot jsonb not null,
  artifact jsonb,
  candidate jsonb,
  verified boolean not null default false,
  activated boolean not null default false,
  created_at timestamptz not null default now(),
  unique(project_id,actor_id,idempotency_key)
);
create index publication_snapshots_project on public.publication_snapshots(project_id,created_at desc);
create table public.publication_aliases (
  host text primary key check(host = lower(host)),
  project_id uuid not null references public.projects(id) on delete cascade,
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create index publication_aliases_project on public.publication_aliases(project_id);
create table public.publication_invitations (
  project_id uuid not null references public.projects(id) on delete cascade,
  email text not null check(email=lower(email)),
  created_at timestamptz not null default now(),
  primary key(project_id,email)
);
create table public.publication_handoffs (
  token_hash text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  host text not null,
  return_path text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index publication_handoffs_expiry on public.publication_handoffs(expires_at);
create table public.publication_visitor_sessions (
  token_hash text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  host text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index publication_sessions_project_user on public.publication_visitor_sessions(project_id,user_id);
create index publication_sessions_expiry on public.publication_visitor_sessions(expires_at);
create table public.publication_invitation_outbox (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  release_id uuid not null,
  email text not null,
  status text not null default 'pending' check(status in ('pending','sent','failed')),
  error text,
  unique(release_id,email)
);

alter table public.project_publication_state enable row level security;
alter table public.publication_snapshots enable row level security;
alter table public.publication_aliases enable row level security;
alter table public.publication_invitations enable row level security;
alter table public.publication_handoffs enable row level security;
alter table public.publication_visitor_sessions enable row level security;
alter table public.publication_invitation_outbox enable row level security;
revoke all on public.project_publication_state,public.publication_snapshots,public.publication_aliases,public.publication_invitations,public.publication_handoffs,public.publication_visitor_sessions,public.publication_invitation_outbox from public,anon,authenticated;
grant all on public.project_publication_state,public.publication_snapshots,public.publication_aliases,public.publication_invitations,public.publication_handoffs,public.publication_visitor_sessions,public.publication_invitation_outbox to service_role;
grant usage,select on sequence public.publication_invitation_outbox_id_seq to service_role;
-- service_role uses BYPASSRLS in Supabase; explicit policies also support local
-- least-privilege server fixtures without granting website users any access.
create policy publication_state_server on public.project_publication_state to service_role using(true) with check(true);
create policy publication_snapshot_server on public.publication_snapshots to service_role using(true) with check(true);
create policy publication_alias_server on public.publication_aliases to service_role using(true) with check(true);
create policy publication_invite_server on public.publication_invitations to service_role using(true) with check(true);
create policy publication_handoff_server on public.publication_handoffs to service_role using(true) with check(true);
create policy publication_session_server on public.publication_visitor_sessions to service_role using(true) with check(true);
create policy publication_outbox_server on public.publication_invitation_outbox to service_role using(true) with check(true);

-- All RPCs are SECURITY INVOKER and server-only. Caller identity comes from the
-- authenticated server principal, never from user_metadata or browser payloads.
create function public.publication_can_publish(p_project uuid,p_actor uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare allowed boolean; org uuid;
begin
  select (owner_id=p_actor or to_jsonb(p)->>'created_by'=p_actor::text),organization_id into allowed,org from public.projects p where id=p_project;
  if coalesce(allowed,false) then return true; end if;
  if to_regclass('public.project_members') is not null then
    execute 'select exists(select 1 from public.project_members where project_id=$1 and user_id=$2 and role in (''owner'',''admin'',''platform_admin''))' into allowed using p_project,p_actor;
    if allowed then return true; end if;
  end if;
  if to_regclass('public.organization_members') is not null then
    execute 'select exists(select 1 from public.organization_members where organization_id=$1 and user_id=$2 and role in (''owner'',''admin'',''platform_admin''))' into allowed using org,p_actor;
    if allowed then return true; end if;
  end if;
  return false;
end $$;
create function public.publication_reserve_address(p_project uuid,p_host text) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  insert into public.publication_aliases(host,project_id) values(p_host,p_project)
  on conflict(host) do update set project_id=publication_aliases.project_id
  where publication_aliases.project_id=p_project;
  if not found then raise exception 'PUBLICATION_ADDRESS_TAKEN'; end if;
end $$;

create function public.publication_enqueue(p_id uuid,p_project uuid,p_actor uuid,p_org uuid,p_key text,p_job text,p_snapshot jsonb)
returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare existing text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_project::text,42));
  if not public.publication_can_publish(p_project,p_actor) then raise exception 'PUBLICATION_FORBIDDEN'; end if;
  if exists(select 1 from public.project_publication_state where project_id=p_project and removal_pending) then raise exception 'PUBLICATION_REMOVAL_PENDING'; end if;
  select job_id into existing from public.publication_snapshots where project_id=p_project and actor_id=p_actor and idempotency_key=p_key;
  if found then return existing; end if;
  if exists(select 1 from public.agent_jobs where project_id=p_project and type='publish' and status in ('pending','processing')) then raise exception 'PUBLICATION_BUSY'; end if;
  insert into public.publication_snapshots(id,project_id,actor_id,idempotency_key,job_id,snapshot) values(p_id,p_project,p_actor,p_key,p_job,p_snapshot);
  insert into public.agent_jobs(id,type,status,project_id,user_id,organization_id,payload,max_attempts)
  values(p_job,'publish','pending',p_project,p_actor,p_org,jsonb_build_object('publication_snapshot_id',p_id),1);
  return p_job;
end $$;

create function public.publication_activate(p_snapshot uuid,p_host text,p_lease uuid) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.publication_snapshots; old_settings jsonb;
begin
  select * into strict s from public.publication_snapshots where id=p_snapshot;
  perform 1 from public.agent_jobs where id=s.job_id for update;
  perform pg_advisory_xact_lock(hashtextextended(s.project_id::text,42));
  select * into strict s from public.publication_snapshots where id=p_snapshot for update;
  if not public.publication_can_publish(s.project_id,s.actor_id) then raise exception 'PUBLICATION_FORBIDDEN'; end if;
  if not exists(select 1 from public.agent_jobs where id=s.job_id and status='processing' and lease_token=p_lease and lease_expires_at>clock_timestamp()) then raise exception 'PUBLICATION_LEASE_LOST'; end if;
  if not s.verified then raise exception 'PUBLICATION_NOT_VERIFIED'; end if;
  if s.activated then return; end if;
  if not exists(select 1 from public.project_publication_state where project_id=s.project_id and generation=coalesce((s.snapshot->>'publication_generation')::integer,0)) then raise exception 'PUBLICATION_INVALIDATED'; end if;
  select effective into old_settings from public.project_publication_state where project_id=s.project_id for update;
  perform public.publication_reserve_address(s.project_id,p_host);
  update public.publication_aliases set active=true where project_id=s.project_id
    and (host=p_host or host in (select jsonb_array_elements_text(coalesce(s.snapshot->'hosts','[]'::jsonb))));
  delete from public.publication_invitations where project_id=s.project_id;
  insert into public.publication_invitations(project_id,email)
  select s.project_id,value from jsonb_array_elements_text(s.snapshot->'settings'->'invitations');
  insert into public.publication_invitation_outbox(project_id,release_id,email)
  select s.project_id,s.id,email from public.publication_invitations where project_id=s.project_id
  and not coalesce(old_settings->'invitations','[]'::jsonb) ? email
  on conflict do nothing;
  update public.project_publication_state set effective=s.snapshot->'settings',release_id=s.id,
    fingerprint=s.snapshot->>'fingerprint',enabled=true,updated_at=now() where project_id=s.project_id;
  -- Revocation takes effect for already-issued website sessions too.
  delete from public.publication_visitor_sessions where project_id=s.project_id;
  update public.publication_snapshots set activated=true where id=s.id;
  if to_regclass('public.deployments') is not null then
    execute 'insert into public.deployments(id,project_id,organization_id,provider,deployment_url,public_url,status,commit_hash,branch,badge_required) select $1,$2,organization_id,''cloudflare-workers'',$3,$3,''ready'',$4,''main'',false from public.projects where id=$2 on conflict(id) do nothing'
      using s.id,s.project_id,'https://' || p_host,s.snapshot->>'fingerprint';
  end if;
  if s.snapshot->'settings'->>'audience' <> 'public' and to_regclass('public.community_listings') is not null then
    execute 'update public.community_listings set status=''removed_by_user'',updated_at=now() where project_id=$1' using s.project_id;
  end if;
end $$;

create function public.publication_checkpoint(p_snapshot uuid,p_lease uuid,p_patch jsonb) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare job text;
begin
  select job_id into strict job from public.publication_snapshots where id=p_snapshot;
  perform 1 from public.agent_jobs where id=job for update;
  if not exists(select 1 from public.agent_jobs where id=job and status='processing' and lease_token=p_lease and lease_expires_at>clock_timestamp()) then raise exception 'PUBLICATION_LEASE_LOST'; end if;
  if exists(select 1 from jsonb_object_keys(p_patch) key where key not in ('artifact','candidate','verified')) then raise exception 'INVALID_PUBLICATION_CHECKPOINT'; end if;
  update public.publication_snapshots set artifact=case when p_patch?'artifact' then p_patch->'artifact' else artifact end,
    candidate=case when p_patch?'candidate' then p_patch->'candidate' else candidate end,
    verified=case when p_patch?'verified' then (p_patch->>'verified')::boolean else verified end
    where id=p_snapshot and not activated;
  if not found then raise exception 'PUBLICATION_ALREADY_ACTIVATED'; end if;
end $$;

create function public.publication_consume_handoff(p_hash text,p_project uuid,p_host text,p_session_hash text,p_session_expiry timestamptz)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare h public.publication_handoffs;
begin
  update public.publication_handoffs set consumed_at=now() where token_hash=p_hash and project_id=p_project and host=p_host
  and consumed_at is null and expires_at>clock_timestamp() returning * into h;
  if not found then return null; end if;
  insert into public.publication_visitor_sessions(token_hash,project_id,user_id,host,expires_at)
  values(p_session_hash,p_project,h.user_id,p_host,p_session_expiry);
  return jsonb_build_object('user_id',h.user_id,'return_path',h.return_path);
end $$;
create function public.publication_disable(p_project uuid) returns integer
language plpgsql security invoker set search_path=public,pg_temp as $$
declare removal_generation integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_project::text,42));
  if exists(select 1 from public.agent_jobs where project_id=p_project and type='publish' and status in ('pending','processing')) then raise exception 'PUBLICATION_BUSY'; end if;
  update public.project_publication_state set enabled=false,removal_pending=true,generation=generation+1,updated_at=now() where project_id=p_project returning generation into strict removal_generation;
  update public.agent_jobs set reconciliation_required=false where project_id=p_project and type='publish' and status='failed';
  update public.publication_aliases set active=false where project_id=p_project;
  delete from public.publication_visitor_sessions where project_id=p_project;
  delete from public.publication_handoffs where project_id=p_project;
  if to_regclass('public.deployments') is not null then
    -- Only V2 gateways are already denied by the state change above. Legacy
    -- origins must remain discoverable until their provider teardown succeeds.
    execute 'update public.deployments d set status=''removed'',updated_at=now() where d.project_id=$1 and d.provider=''cloudflare-workers'' and exists(select 1 from public.publication_snapshots s where s.id=d.id and s.project_id=$1 and s.activated)' using p_project;
  end if;
  if to_regclass('public.community_listings') is not null then
    execute 'update public.community_listings set status=''removed_by_user'',updated_at=now() where project_id=$1' using p_project;
  end if;
  return removal_generation;
end $$;
create function public.publication_complete_removal(p_project uuid,p_generation integer) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_project::text,42));
  update public.project_publication_state set removal_pending=false,updated_at=now()
    where project_id=p_project and generation=p_generation and not enabled and removal_pending;
  return found;
end $$;
revoke all on function public.publication_reserve_address(uuid,text),public.publication_enqueue(uuid,uuid,uuid,uuid,text,text,jsonb),public.publication_activate(uuid,text,uuid),public.publication_consume_handoff(text,uuid,text,text,timestamptz),public.publication_disable(uuid) from public,anon,authenticated;
grant execute on function public.publication_reserve_address(uuid,text),public.publication_enqueue(uuid,uuid,uuid,uuid,text,text,jsonb),public.publication_activate(uuid,text,uuid),public.publication_consume_handoff(text,uuid,text,text,timestamptz),public.publication_disable(uuid) to service_role;
revoke all on function public.publication_can_publish(uuid,uuid) from public,anon,authenticated;
grant execute on function public.publication_can_publish(uuid,uuid) to service_role;
revoke all on function public.publication_checkpoint(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.publication_checkpoint(uuid,uuid,jsonb) to service_role;
revoke all on function public.publication_complete_removal(uuid,integer) from public,anon,authenticated;
grant execute on function public.publication_complete_removal(uuid,integer) to service_role;
