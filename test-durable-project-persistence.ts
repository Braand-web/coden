import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
const builder = readFileSync(new URL('./src/builder-live.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./supabase/migrations/20260613090000_durable_project_snapshots.sql', import.meta.url), 'utf8');

assert.match(migration, /create table if not exists public\.project_state_snapshots/i);
assert.match(migration, /files_snapshot jsonb/i);
assert.match(migration, /messages_snapshot jsonb/i);
assert.match(migration, /events_snapshot jsonb/i);
assert.match(migration, /preview_snapshot jsonb/i);
assert.match(migration, /enable row level security/i);

assert.match(server, /async function persistDurableProjectSnapshot/);
assert.match(server, /async function appendDurableProjectSnapshotItem/);
assert.match(server, /async function loadDurableProjectSnapshot/);
assert.match(server, /function recoverProjectPayloadFromSnapshot/);
assert.match(server, /await refreshDurableProjectSnapshot\(updatedProject, finalFiles\)/);
assert.match(server, /field: 'messages_snapshot'/);
assert.match(server, /field: 'events_snapshot'/);
assert.match(server, /recovery_source: recovered\.recovery_source/);

assert.match(builder, /payload\.preview\.status !== 'idle'/);
assert.match(builder, /restoreStreamPartsFromPayloadEvents\(payload\)/);
assert.match(builder, /restoreLatestStreamPartsFromRunHistory\(payload\)/);

console.log('Durable project persistence tests passed.');
