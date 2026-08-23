import assert from 'node:assert/strict';
import { scanGeneratedSecurity } from './src/services/generated-security-scanner.ts';

const secureSchema = `
create table if not exists public.app_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  title text not null,
  created_at timestamptz not null default now()
);

alter table public.app_tasks enable row level security;

create policy "Users can read their app_tasks" on public.app_tasks
  for select to authenticated using (owner_id = auth.uid());

create policy "Users can insert their app_tasks" on public.app_tasks
  for insert to authenticated with check (owner_id = auth.uid());
`;

{
  const result = scanGeneratedSecurity([
    { path: 'supabase/schema.sql', content: secureSchema },
    { path: 'src/lib/validation.ts', content: "import { z } from 'zod'; export const TaskSchema = z.object({ title: z.string().min(1) });" },
  ]);

  assert.equal(result.status, 'passed');
  assert.equal(result.checks.find(check => check.key === 'security_all_private_tables_rls')?.status, 'pass');
  assert.equal(result.checks.find(check => check.key === 'security_no_user_metadata_authz')?.status, 'pass');
  assert.equal(result.checks.find(check => check.key === 'security_no_public_security_definer')?.status, 'pass');
}

{
  const result = scanGeneratedSecurity([
    {
      path: 'supabase/schema.sql',
      content: `
create table if not exists public.app_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  title text not null
);

create policy "Unsafe metadata auth" on public.app_tasks
  for select to authenticated using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create or replace function public.run_admin_task()
returns void
language plpgsql
security definer
as $$ begin return; end; $$;
`,
    },
    { path: 'src/lib/validation.ts', content: "import { z } from 'zod'; export const TaskSchema = z.object({ title: z.string().min(1) });" },
  ]);

  assert.equal(result.status, 'failed');
  assert.equal(result.checks.find(check => check.key === 'security_all_private_tables_rls')?.status, 'fail');
  assert.equal(result.checks.find(check => check.key === 'security_no_user_metadata_authz')?.status, 'fail');
  assert.equal(result.checks.find(check => check.key === 'security_no_public_security_definer')?.status, 'fail');
}

console.log('generated security scanner tests passed');
