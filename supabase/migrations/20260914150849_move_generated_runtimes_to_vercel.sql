-- Retire Cloudflare/legacy runtime contracts without losing generated projects.
-- The application files themselves are upgraded lazily by the server when an
-- old project is opened; this migration keeps persisted metadata compatible
-- with the Vercel-only runtime contract.

do $$
begin
  if to_regclass('public.project_runtime_profiles') is not null then
    update public.project_runtime_profiles
    set
      runtime = case
        when profile = 'tanstack-fullstack' then 'vercel-functions'
        when profile = 'node-fullstack' then 'node-server'
        else 'static-assets'
      end,
      manifest = jsonb_set(
        coalesce(manifest, '{}'::jsonb),
        '{runtime}',
        to_jsonb(case
          when profile = 'tanstack-fullstack' then 'vercel-functions'::text
          when profile = 'node-fullstack' then 'node-server'::text
          else 'static-assets'::text
        end),
        true
      ),
      updated_at = now()
    where runtime in ('cloudflare-workers', 'legacy-vercel')
       or manifest ->> 'runtime' in ('cloudflare-workers', 'legacy-vercel');

    alter table public.project_runtime_profiles
      drop constraint if exists project_runtime_profiles_runtime_check;

    alter table public.project_runtime_profiles
      add constraint project_runtime_profiles_runtime_check
      check (runtime in ('vercel-functions', 'node-server', 'static-assets'));
  end if;

  if to_regclass('public.generated_app_manifests') is not null then
    update public.generated_app_manifests
    set
      runtime = case
        when profile = 'tanstack-fullstack' then 'vercel-functions'
        when profile = 'node-fullstack' then 'node-server'
        else 'static-assets'
      end,
      manifest = jsonb_set(
        coalesce(manifest, '{}'::jsonb),
        '{runtime}',
        to_jsonb(case
          when profile = 'tanstack-fullstack' then 'vercel-functions'::text
          when profile = 'node-fullstack' then 'node-server'::text
          else 'static-assets'::text
        end),
        true
      )
    where runtime in ('cloudflare-workers', 'legacy-vercel')
       or manifest ->> 'runtime' in ('cloudflare-workers', 'legacy-vercel');
  end if;
end $$;
