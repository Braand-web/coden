-- Vercel is the only active publication provider for generated Coden apps.
-- Keep this migration idempotent so it can be applied to projects that still
-- have the older Cloudflare defaults from the first publishing implementation.

do $$
begin
  if to_regclass('public.deployments') is not null then
    alter table public.deployments alter column provider set default 'vercel';
    update public.deployments
    set provider = 'vercel'
    where provider is null
       or provider in ('cloudflare', 'cloudflare-pages', 'cloudflare-workers');
  end if;

  if to_regclass('public.deployment_domains') is not null then
    alter table public.deployment_domains alter column provider set default 'vercel';
    update public.deployment_domains
    set provider = 'vercel'
    where provider is null
       or provider in ('cloudflare', 'cloudflare-pages', 'cloudflare-workers');
  end if;
end $$;

create index if not exists deployments_vercel_project_idx
  on public.deployments (project_id, provider, created_at desc);
