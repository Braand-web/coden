import assert from 'node:assert/strict';
import { buildExecutionContract } from './src/services/execution-contract.ts';
import {
  buildExecutionSyncMatrix,
  executionContractToAIWorkflowTask,
  validateExecutionSync,
} from './src/services/execution-sync-matrix.ts';
import { buildInternalExecutionPlan } from './src/services/agent-execution-os.ts';

{
  const contract = buildExecutionContract({ prompt: 'bonjour', hasFiles: true });
  const matrix = buildExecutionSyncMatrix(contract);
  assert.equal(matrix.user_visible_surface, 'plain_chat');
  assert.equal(matrix.mutation_policy, 'never');
  assert.equal(matrix.save_policy, 'none');
  assert.equal(executionContractToAIWorkflowTask(contract), 'conversation');
  const validation = validateExecutionSync(matrix, { filesChanged: false });
  assert.equal(validation.status, 'passed');
}

{
  const contract = buildExecutionContract({
    prompt: 'cree une vraie todo app web avec ajout de tache, suppression, filtres et localStorage',
    hasFiles: false,
  });
  const matrix = buildExecutionSyncMatrix(contract);
  assert.equal(matrix.user_visible_surface, 'rich_parts_stream');
  assert.equal(matrix.mutation_policy, 'allowed');
  assert.equal(matrix.save_policy, 'atomic_versioned');
  assert.equal(matrix.recovery_policy, 'autofix_then_draft');
  assert.ok(matrix.required_layers.includes('tool_loop'));
  assert.ok(matrix.required_layers.includes('browser_testing'));
  assert.ok(matrix.required_layers.includes('autofix'));
  assert.ok(matrix.required_layers.includes('atomic_save'));
  assert.ok(matrix.required_layers.includes('preview'));
  assert.equal(executionContractToAIWorkflowTask(contract), 'frontend_generation');

  const missing = validateExecutionSync(matrix, {
    filesChanged: true,
    previewReady: true,
    runnerChecked: true,
    browserChecked: false,
    versionSaved: false,
    draftSaved: false,
  });
  assert.equal(missing.status, 'failed');
  assert.ok(missing.findings.some(item => item.key === 'atomic_save_missing'));

  const aligned = validateExecutionSync(matrix, {
    filesChanged: true,
    previewReady: true,
    runnerChecked: true,
    browserChecked: true,
    versionSaved: true,
    securityChecked: true,
    memoryUpdated: true,
  });
  assert.equal(aligned.status, 'passed');
}

{
  const contract = buildExecutionContract({
    prompt: 'corrige preview blanche: index.html should load /src/main.tsx as a module',
    hasFiles: true,
  });
  const matrix = buildExecutionSyncMatrix(contract);
  assert.equal(contract.mode, 'debug');
  assert.equal(matrix.user_visible_surface, 'rich_parts_stream');
  assert.equal(matrix.recovery_policy, 'autofix_then_draft');
  assert.equal(executionContractToAIWorkflowTask(contract), 'debug');
}

{
  const contract = buildExecutionContract({ prompt: 'publie maintenant', hasFiles: true });
  const matrix = buildExecutionSyncMatrix(contract);
  assert.equal(matrix.user_visible_surface, 'confirmation');
  assert.equal(matrix.mutation_policy, 'only_after_confirmation');
  assert.equal(matrix.publish_policy, 'confirm_before_publish');
  const unsafe = validateExecutionSync(matrix, { filesChanged: true, confirmationRequested: false, securityChecked: true });
  assert.equal(unsafe.status, 'failed');
  assert.ok(unsafe.findings.some(item => item.key === 'missing_confirmation'));
}

{
  const contract = buildExecutionContract({
    prompt: 'cree une app SaaS avec auth Supabase et billing Stripe',
    hasFiles: false,
  });
  const plan = buildInternalExecutionPlan({ contract, prompt: 'x', hasExistingFiles: false });
  assert.equal(plan.sync_matrix.version, 'execution-sync-matrix/v1');
  assert.equal(plan.user_visible_surface, 'rich_parts_stream');
  assert.ok(plan.required_layers.includes('security'));
  assert.ok(plan.required_layers.includes('browser_testing'));
  assert.equal(plan.save_policy, 'atomic_versioned');
}

console.log('execution sync matrix tests passed');
