import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/202606010001_agent_v2.sql', 'utf8').toLowerCase();
const v3Sql = fs.readFileSync('supabase/migrations/202606010002_agent_v3_runner_research.sql', 'utf8').toLowerCase();

for (const table of ['agent_runs', 'agent_run_steps', 'agent_memories', 'agent_verifications']) {
  assert.ok(sql.includes(`create table if not exists public.${table}`), `${table} must be idempotent`);
}

for (const existing of ['project_messages', 'agent_events', 'build_sessions', 'project_versions', 'project_workspace_state']) {
  assert.ok(sql.includes(`alter table if exists public.${existing}`), `${existing} must be reinforced safely`);
}

assert.ok(sql.includes('add column if not exists'), 'migration must use add column if not exists');
assert.ok(sql.includes('create index if not exists'), 'migration must create indexes idempotently');
assert.ok(sql.includes('create unique index if not exists idx_agent_memories_project_type_unique'), 'agent memory upsert needs a unique index');

for (const table of ['agent_runner_results', 'agent_research_results']) {
  assert.ok(v3Sql.includes(`create table if not exists public.${table}`), `${table} must be idempotent`);
  assert.ok(v3Sql.includes(`alter table public.${table} enable row level security`), `${table} must enable RLS`);
}

for (const column of ['tool_budget', 'research_used', 'runner_status']) {
  assert.ok(v3Sql.includes(`add column if not exists ${column}`), `${column} must be added safely`);
}

assert.ok(v3Sql.includes('create index if not exists'), 'v3 migration must create indexes idempotently');

console.log('test-agent-migrations passed');
