export const CODEN_USER_ROLES_CONTRACT_VERSION = 'coden-user-roles-contract-v1';

export const CODEN_USER_ROLES_CONTRACT = [
  `User roles contract version: ${CODEN_USER_ROLES_CONTRACT_VERSION}.`,
  'Roles MUST be stored in a dedicated table (e.g. public.user_roles), never on the profiles table, never on auth.users metadata editable by the user, never in localStorage, never in a hidden form field.',
  'Storing roles on a user-editable surface causes privilege escalation. This rule is absolute.',
  'Canonical pattern:',
  "  create type public.app_role as enum ('admin','moderator','user');",
  '  create table public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade not null, role app_role not null, unique (user_id, role));',
  '  alter table public.user_roles enable row level security;',
  '  create or replace function public.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;',
  'Use the SECURITY DEFINER has_role() function inside RLS policies to avoid recursive policy evaluation on user_roles itself.',
  'Never check admin status client-side using localStorage, sessionStorage, URL params, or hardcoded emails. Always call has_role(auth.uid(), \'admin\') server-side inside RLS or edge functions.',
].join('\n');
