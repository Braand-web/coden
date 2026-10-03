import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { writeDurableSnapshot, isSnapshotTableMissing, requireDurableCheckpoint } from './durable-snapshot-write';

function database() {
  const rows = new Map<string, any>();
  let rejectWrite = false;
  const client = { from: () => ({
    select: () => ({ eq: (_key: string, id: string) => ({ maybeSingle: async () => ({ data: rows.has(id) ? structuredClone(rows.get(id)) : null, error: null }) }) }),
    insert: (row: any) => ({ select: async () => {
      if (rejectWrite) return { error: { code: '42501', message: 'permission denied' } };
      if (rows.has(row.project_id)) return { error: { code: '23505' } };
      rows.set(row.project_id, structuredClone(row));
      return { data: [{ project_id: row.project_id }] };
    } }),
    update: (patch: any) => {
      const filters: Record<string, any> = {};
      const query = { eq: (key: string, value: any) => { filters[key] = value; return query; }, select: async () => {
        if (rejectWrite) return { error: { code: '42501', message: 'permission denied' } };
        const row = rows.get(filters.project_id);
        if (!row || row.revision !== filters.revision) return { data: [] };
        rows.set(filters.project_id, { ...row, ...structuredClone(patch) });
        return { data: [{ project_id: filters.project_id }] };
      } };
      return query;
    },
  }) };
  return { rows, client, reject: () => { rejectWrite = true; } };
}

describe('durable snapshots under concurrent writes and reload', () => {
  it('keeps every concurrent append including the first-row creation race', async () => {
    const db = database();
    await Promise.all(['a', 'b', 'c', 'd'].map(id => writeDurableSnapshot({ client: db.client, projectId: 'app', ownerId: 'owner', readColumns: ['messages_snapshot'],
      patch: current => ({ messages_snapshot: [...(current?.messages_snapshot || []), { id }] }) })));
    expect(db.rows.get('app').messages_snapshot.map((x: any) => x.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    // New process state is represented by reading a fresh database copy, not a memory cache.
    expect(structuredClone(db.rows.get('app')).messages_snapshot).toHaveLength(4);
  });
  it('keeps files, messages and workspace from simultaneous independent updates', async () => {
    const db = database();
    await writeDurableSnapshot({ client: db.client, projectId: 'app', ownerId: 'owner', patch: () => ({ files_snapshot: [{ path: 'style.css', content: 'design' }] }) });
    await Promise.all([
      writeDurableSnapshot({ client: db.client, projectId: 'app', ownerId: 'owner', patch: () => ({ workspace_snapshot: { mode: 'preview' } }) }),
      writeDurableSnapshot({ client: db.client, projectId: 'app', ownerId: 'owner', readColumns: ['messages_snapshot'], patch: row => ({ messages_snapshot: [...(row?.messages_snapshot || []), 'stream'] }) }),
    ]);
    expect(db.rows.get('app')).toMatchObject({ files_snapshot: [{ path: 'style.css', content: 'design' }], messages_snapshot: ['stream'], workspace_snapshot: { mode: 'preview' } });
  });
  it('cannot change identity through a patch and isolates projects', async () => {
    const db = database();
    await writeDurableSnapshot({ client: db.client, projectId: 'a', ownerId: 'owner-a', patch: () => ({ project_id: 'b', owner_id: 'owner-b', files_snapshot: ['a'] }) });
    expect(db.rows.has('b')).toBe(false);
    expect(db.rows.get('a').owner_id).toBe('owner-a');
  });
  it('does not report success when permissions or storage fail', async () => {
    const db = database(); db.reject();
    await expect(writeDurableSnapshot({ client: db.client, projectId: 'a', ownerId: 'owner', patch: () => ({}) })).rejects.toMatchObject({ code: '42501' });
    expect(() => requireDurableCheckpoint(false)).toThrow('CHECKPOINT_UNAVAILABLE');
    expect(() => requireDurableCheckpoint(true)).not.toThrow();
  });
  it('bounds conflicts instead of claiming an unacknowledged write succeeded', async () => {
    const db = database();
    await expect(writeDurableSnapshot({ client: db.client, projectId: 'a', ownerId: 'owner', patch: () => ({}), maxAttempts: 0 })).rejects.toThrow('SNAPSHOT_WRITE_CONFLICT');
  });
  it('only treats an actually missing snapshot table as unavailable', () => {
    expect(isSnapshotTableMissing({ message: 'relation "public.project_state_snapshots" does not exist' })).toBe(true);
    expect(isSnapshotTableMissing({ message: "Could not find the table 'public.project_state_snapshots' in the schema cache" })).toBe(true);
    expect(isSnapshotTableMissing({ message: 'permission denied for table project_state_snapshots' })).toBe(false);
    expect(isSnapshotTableMissing({ message: 'project_state_snapshots request timed out' })).toBe(false);
    expect(isSnapshotTableMissing({ message: 'schema cache reload failed' })).toBe(false);
  });
  it('requires acknowledgement in the generation checkpoint path', () => {
    const server = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
    expect(server).toContain('requireDurableCheckpoint(checkpointSaved)');
    expect(server).not.toContain("listProjectMessages(project.id).catch(() => [])");
    expect(server).not.toContain("from('project_state_snapshots').upsert");
    expect(server).toContain('if (files?.length && !filesSaved) requireDurableCheckpoint(snapshotSaved)');
    expect(server).toContain('PROJECT_FILES_NOT_SAVED: schema compatibility retries exhausted');
    expect(server).toContain("if (['project_id', 'path', 'content'].includes(column)) return null");
    const loader = server.slice(server.indexOf('async function loadProjectFiles('), server.indexOf('function isMissingProjectSnapshotTableError'));
    expect(loader).toContain('isProjectFilesMissingError(error)');
    expect(loader).not.toContain('/project_files|');
  });
});
