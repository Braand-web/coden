-- Allow honest standalone Node/Express generated-app runtime metadata.

alter table if exists public.project_runtime_profiles
  drop constraint if exists project_runtime_profiles_profile_check,
  drop constraint if exists project_runtime_profiles_runtime_check,
  drop constraint if exists project_runtime_profiles_backend_check;

alter table if exists public.project_runtime_profiles
  add constraint project_runtime_profiles_profile_check
    check (profile in ('tanstack-fullstack','node-fullstack','vite-static','legacy-vite-fullstack')),
  add constraint project_runtime_profiles_runtime_check
    check (runtime in ('cloudflare-workers','node-server','static-assets','legacy-vercel')),
  add constraint project_runtime_profiles_backend_check
    check (backend in ('coden-cloud-supabase','node-api','none'));
