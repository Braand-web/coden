import assert from 'node:assert/strict';
import { selectRelevantMemoryRows, type ProjectMemoryRow } from './src/services/agent-memory-rag.ts';

const now = Date.now();
const rows: ProjectMemoryRow[] = [
  {
    id: 'verified-user-auth',
    project_id: 'project-1',
    memory_type: 'user_instruction',
    content: 'Toujours protéger les routes dashboard avec Supabase Auth et RLS.',
    source: 'user',
    verified: true,
    confidence: 1,
    updated_at: new Date(now - 60_000).toISOString(),
  },
  {
    id: 'unrelated-pattern',
    project_id: 'project-1',
    memory_type: 'pattern',
    content: 'Le footer marketing utilise une grille responsive.',
    source: 'model_candidate',
    confidence: 0.4,
    updated_at: new Date(now - 120_000).toISOString(),
  },
  {
    id: 'expired-auth',
    project_id: 'project-1',
    memory_type: 'adr',
    content: 'Utiliser une ancienne authentification locale pour le dashboard.',
    source: 'legacy',
    verified: false,
    expires_at: new Date(now - 1_000).toISOString(),
  },
];

const selected = selectRelevantMemoryRows(rows, 'Sécurise le dashboard avec Supabase Auth', 2);
assert.equal(selected[0]?.id, 'verified-user-auth');
assert.equal(selected.some(row => row.id === 'expired-auth'), false);
assert.equal(selectRelevantMemoryRows(rows, 'dashboard', 0).length, 0);

console.log('agent memory retrieval tests passed');
