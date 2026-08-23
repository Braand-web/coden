import assert from 'node:assert/strict';
import {
  applySeniorAgentContextToPrompt,
  compileSeniorAgentContext,
  decomposeAgentTask,
  inferProductBlueprint,
  indexProjectCodebase,
  seniorAgentPromptContext,
} from './src/services/senior-agent-os.ts';

const files = [
  {
    path: 'package.json',
    content: '{"scripts":{"build":"vite build","test":"vitest"}}',
  },
  {
    path: 'src/App.tsx',
    content: `
      import { supabase } from './lib/supabase';
      fetch('/api/projects/demo');
      export function App() { return <main><button>Save</button></main>; }
      supabase.auth.getUser();
    `,
  },
  {
    path: 'src/components/BillingCard.tsx',
    content: "export const BillingCard = () => fetch('/api/billing/wallet');",
  },
  {
    path: 'schema.sql',
    content: 'create table if not exists public.tasks (id uuid primary key, title text);',
  },
  {
    path: 'src/styles.css',
    content: ':root { --bg: #fff; --text: #09090b; }',
  },
];

const projectIndex = indexProjectCodebase(files);
assert.equal(projectIndex.file_count, files.length);
assert.ok(projectIndex.routes.includes('/'), 'App route should be indexed');
assert.ok(projectIndex.components.includes('src/components/BillingCard.tsx'), 'component files should be indexed');
assert.ok(projectIndex.api_endpoints.includes('/api/projects/demo'), 'API endpoints should be indexed');
assert.ok(projectIndex.database_tables.includes('public.tasks'), 'database tables should be indexed');
assert.ok(projectIndex.style_tokens.includes('bg'), 'style tokens should be indexed');
assert.ok(projectIndex.auth_files.includes('src/App.tsx'), 'auth usage should be indexed');
assert.ok(projectIndex.billing_files.includes('src/components/BillingCard.tsx'), 'billing files should be indexed');
assert.ok(projectIndex.critical_files.includes('package.json'), 'critical files should include package.json');

const tasks = decomposeAgentTask({
  prompt: 'Ajoute auth Google, database CRUD, billing, puis rends le dashboard premium.',
  decision: { intent: 'build', requiresFileChanges: true, requiresPreviewRebuild: true },
});
assert.ok(tasks.some(task => task.id === 'auth'), 'auth work should be decomposed');
assert.ok(tasks.some(task => task.id === 'database'), 'database work should be decomposed');
assert.ok(tasks.some(task => task.id === 'billing'), 'billing work should be decomposed');
assert.ok(tasks.some(task => task.id === 'dashboard'), 'dashboard work should be decomposed');
assert.ok(tasks.every(task => task.label && task.area), 'tasks should stay user-safe and structured');

const blueprint = inferProductBlueprint('Cree un CRM pour suivre clients, leads, pipeline et factures.');
assert.equal(blueprint.platform_type, 'crm');
assert.ok(blueprint.required_components.some(item => item.toLowerCase().includes('client')), 'CRM blueprint should require client list');
assert.ok(blueprint.required_states.includes('loading'), 'blueprint should require loading state');
assert.ok(blueprint.forbidden_patterns.includes('dead primary buttons'), 'blueprint should forbid dead controls');

const context = compileSeniorAgentContext({
  prompt: 'Ajoute auth Google, database CRUD, billing, puis rends le dashboard premium.',
  project: { name: 'Coden test project' },
  files,
  decision: { intent: 'build', confidence: 0.72, requiresFileChanges: true, requiresPreviewRebuild: true },
  importContext: { source: 'github', status: 'ready', source_url: 'https://github.com/acme/demo' },
});

assert.equal(context.version, 'senior-agent-os-v1');
assert.ok(context.policy.action_contract.no_fake_success, 'policy should enforce no fake success');
assert.ok(context.policy.action_contract.rollback_required, 'risky work should require rollback');
assert.ok(context.policy.risk_score >= 78, 'auth/database/billing work should be high risk');
assert.ok(context.policy.confidence_score <= 100 && context.policy.confidence_score >= 0, 'confidence should be bounded');
assert.ok(context.playbooks.some(playbook => playbook.id === 'add-auth'), 'auth playbook should be selected');
assert.ok(context.playbooks.some(playbook => playbook.id === 'add-database-crud'), 'database playbook should be selected');
assert.ok(context.playbooks.some(playbook => playbook.id === 'import-from-github'), 'GitHub import playbook should be selected');
assert.equal(context.architect_blueprint.version, 'coden-architect-blueprint-v1');
assert.equal(context.architect_blueprint.archetype, 'saas_webapp');
assert.ok(context.architect_blueprint.blueprint_sections.includes('Build order'), 'architect blueprint should keep the 16-section checklist');
assert.ok(context.architect_blueprint.quality_gates.some(gate => gate.includes('No blank preview')), 'architect blueprint should require a nonblank preview');
assert.equal(context.architect_blueprint.confirmation_policy.max_questions_per_turn, 3, 'architect mode should keep questioning tight');

const promptContext = seniorAgentPromptContext(context);
assert.ok(promptContext.includes('Senior Agent OS context'), 'prompt context should be clearly delimited');
assert.ok(promptContext.includes('Coden Architect Blueprint context'), 'prompt context should include Architect Blueprint context');
assert.ok(promptContext.includes('required_blueprint_sections'), 'prompt context should include blueprint completeness sections');
assert.ok(promptContext.includes('known_failure_memory'), 'prompt context should include failure memory');
assert.ok(promptContext.includes('SUPABASE_AUTH_CLIENT_UNDEFINED'), 'prompt context should include known Supabase auth failure');
assert.ok(promptContext.includes('Optional production architecture reference'), 'prompt context should include an optional production architecture reference');
assert.ok(promptContext.includes('Every private table needs RLS'), 'production blueprint should carry hard security rules');

const upgradedPrompt = applySeniorAgentContextToPrompt('Build the app.', context);
assert.ok(upgradedPrompt.startsWith('Build the app.'), 'original user prompt should remain first');
assert.ok(upgradedPrompt.includes('No fake success'), 'upgraded prompt should include no-fake-success instruction');
assert.ok(upgradedPrompt.includes('Senior Agent OS context'), 'upgraded prompt should include senior context');

console.log('senior agent os ok');
