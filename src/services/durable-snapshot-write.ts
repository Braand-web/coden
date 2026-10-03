/** Single-row optimistic concurrency. No schema change or elevated RPC required. */
export async function writeDurableSnapshot(input: {
  client: any;
  projectId: string;
  ownerId: string;
  readColumns?: string[];
  patch: (current: Record<string, any> | null) => Record<string, any>;
  maxAttempts?: number;
}) {
  const columns = [...new Set(['project_id', 'owner_id', 'revision', ...(input.readColumns || [])])].join(',');
  for (let attempt = 0; attempt < (input.maxAttempts ?? 8); attempt += 1) {
    const read = await input.client.from('project_state_snapshots').select(columns).eq('project_id', input.projectId).maybeSingle();
    if (read.error) throw read.error;
    const current = read.data;
    const revision = Number(current?.revision || 0);
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
      throw new Error('SNAPSHOT_REVISION_INVALID');
    }
    const patch: Record<string, any> = { ...input.patch(current), revision: Math.max(Date.now(), revision + 1), updated_at: new Date().toISOString() };
    // Identity is never taken from the mutable payload. Existing ownership is retained.
    delete patch.project_id;
    delete patch.owner_id;
    const result = current
      ? await input.client.from('project_state_snapshots').update(patch)
        .eq('project_id', input.projectId).eq('revision', revision).select('project_id')
      : await input.client.from('project_state_snapshots').insert({ ...patch, project_id: input.projectId, owner_id: input.ownerId }).select('project_id');
    if (result.error) {
      if (!current && result.error.code === '23505') continue;
      throw result.error;
    }
    if (result.data?.length === 1) return true;
    // Another writer won: reload before computing the append again.
  }
  throw new Error('SNAPSHOT_WRITE_CONFLICT: durable checkpoint was not acknowledged');
}

export function isSnapshotTableMissing(error: { message?: string } | null | undefined) {
  return /(?:relation|table)\s+["'`]?[^\s"'`]*project_state_snapshots["'`]?\s+(?:does not exist|not found)|could not find the table\s+["'`]?[^\s"'`]*project_state_snapshots["'`]?\s+in the schema cache/i.test(String(error?.message || ''));
}

export function requireDurableCheckpoint(saved: boolean): void {
  if (!saved) throw new Error('CHECKPOINT_UNAVAILABLE: the generated files could not be durably saved');
}
