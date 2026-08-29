export type GeneratedProjectPatch = {
  baseRevision: string;
  files: Array<{
    path: string;
    operation: 'create' | 'update' | 'delete';
    content?: string;
    contentHash?: string;
  }>;
  dependencies: { add: Record<string, string>; remove: string[] };
  environmentRequirements: string[];
  migrationFiles: string[];
  expectedChecks: string[];
  summary: string;
};

export type PatchValidation = { valid: boolean; errors: string[] };

const SAFE_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9_.@/ -]+$/;
const DEPENDENCY = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;

export function validateGeneratedProjectPatch(patch: GeneratedProjectPatch, currentRevision: string): PatchValidation {
  const errors: string[] = [];
  if (!patch || typeof patch !== 'object') return { valid: false, errors: ['patch is required'] };
  if (!patch.baseRevision || patch.baseRevision !== currentRevision) errors.push('base revision does not match the current snapshot');
  if (!Array.isArray(patch.files)) errors.push('files must be an array');
  const paths = new Set<string>();
  for (const file of patch.files || []) {
    const path = String(file.path || '').replace(/\\/g, '/');
    if (!SAFE_PATH.test(path)) errors.push(`unsafe file path: ${path}`);
    if (paths.has(path)) errors.push(`duplicate file operation: ${path}`);
    paths.add(path);
    if (!['create', 'update', 'delete'].includes(file.operation)) errors.push(`invalid file operation for ${path}`);
    if (file.operation !== 'delete' && typeof file.content !== 'string') errors.push(`content is required for ${path}`);
    if (file.operation === 'delete' && file.content !== undefined) errors.push(`delete operation must not include content for ${path}`);
  }
  for (const name of [...Object.keys(patch.dependencies?.add || {}), ...(patch.dependencies?.remove || [])]) {
    if (!DEPENDENCY.test(name)) errors.push(`invalid dependency name: ${name}`);
  }
  for (const migration of patch.migrationFiles || []) {
    if (!paths.has(migration.replace(/\\/g, '/'))) errors.push(`migration file is missing from patch: ${migration}`);
  }
  if (!String(patch.summary || '').trim()) errors.push('summary is required');
  return { valid: errors.length === 0, errors };
}

export function assertDisjointWriterOwnership(patches: Array<{ workerId: string; patch: GeneratedProjectPatch }>) {
  const ownerByPath = new Map<string, string>();
  const conflicts: Array<{ path: string; workers: string[] }> = [];
  for (const item of patches) {
    for (const file of item.patch.files) {
      const path = file.path.replace(/\\/g, '/');
      const owner = ownerByPath.get(path);
      if (owner && owner !== item.workerId) conflicts.push({ path, workers: [owner, item.workerId] });
      else ownerByPath.set(path, item.workerId);
    }
  }
  return { valid: conflicts.length === 0, conflicts, ownership: ownerByPath };
}
