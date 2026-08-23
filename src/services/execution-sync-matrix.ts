import type { AIWorkflowTask } from './ai-model-runtime.ts';
import type { ExecutionContract, ExecutionContractMode } from './execution-contract.ts';

export type ExecutionSystemLayer =
  | 'intent_router'
  | 'execution_contract'
  | 'planner'
  | 'tool_loop'
  | 'browser_testing'
  | 'autofix'
  | 'atomic_save'
  | 'recovery'
  | 'preview'
  | 'publish'
  | 'security'
  | 'model_runtime'
  | 'memory'
  | 'observability'
  | 'golden_prompts'
  | 'ux_polish';

export type ExecutionSyncMatrix = {
  version: 'execution-sync-matrix/v1';
  mode: ExecutionContractMode;
  ai_task: AIWorkflowTask;
  required_layers: ExecutionSystemLayer[];
  optional_layers: ExecutionSystemLayer[];
  evidence_required: string[];
  user_visible_surface: 'plain_chat' | 'light_plan' | 'rich_parts_stream' | 'confirmation';
  mutation_policy: 'never' | 'only_after_confirmation' | 'allowed';
  save_policy: 'none' | 'atomic_draft' | 'atomic_versioned';
  recovery_policy: 'none' | 'ask_missing_info' | 'autofix_then_draft';
  publish_policy: 'not_applicable' | 'confirm_before_publish' | 'verify_live_after_publish';
  language_policy: 'match_user_language_short';
  no_fake_success: true;
};

export type ExecutionSyncEvidence = {
  filesChanged?: boolean;
  previewReady?: boolean;
  runnerChecked?: boolean;
  browserChecked?: boolean;
  draftSaved?: boolean;
  versionSaved?: boolean;
  confirmationRequested?: boolean;
  liveVerified?: boolean;
  securityChecked?: boolean;
  memoryUpdated?: boolean;
};

export type ExecutionSyncFinding = {
  key: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
};

export type ExecutionSyncValidation = {
  status: 'passed' | 'warning' | 'failed';
  findings: ExecutionSyncFinding[];
};

const BASE_LAYERS: ExecutionSystemLayer[] = [
  'intent_router',
  'execution_contract',
  'model_runtime',
  'observability',
  'ux_polish',
];

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

export function executionContractToAIWorkflowTask(contract: ExecutionContract): AIWorkflowTask {
  if (contract.mode === 'chat') return 'conversation';
  if (contract.mode === 'clarify' || contract.mode === 'critical_action') return 'intent';
  if (contract.mode === 'discuss_first' || contract.mode === 'plan') return 'planning';
  if (contract.mode === 'debug') return 'debug';
  if (contract.mode === 'verify') return 'tests';
  if (contract.target_kind === 'backend' || contract.infrastructure.includes('database') || contract.infrastructure.includes('supabase')) return 'backend_generation';
  if (contract.infrastructure.includes('stripe')) return 'backend_generation';
  if (contract.target_kind === 'ui' || contract.target_kind === 'app' || contract.target_kind === 'project') return 'frontend_generation';
  if (contract.target_kind === 'media') return 'design';
  return contract.can_mutate_files ? 'frontend_generation' : 'conversation';
}

export function buildExecutionSyncMatrix(contract: ExecutionContract): ExecutionSyncMatrix {
  const required: ExecutionSystemLayer[] = [...BASE_LAYERS];
  const optional: ExecutionSystemLayer[] = ['golden_prompts'];
  let userVisibleSurface: ExecutionSyncMatrix['user_visible_surface'] = 'plain_chat';
  let mutationPolicy: ExecutionSyncMatrix['mutation_policy'] = 'never';
  let savePolicy: ExecutionSyncMatrix['save_policy'] = 'none';
  let recoveryPolicy: ExecutionSyncMatrix['recovery_policy'] = 'none';
  let publishPolicy: ExecutionSyncMatrix['publish_policy'] = 'not_applicable';

  if (contract.mode === 'clarify' || contract.mode === 'discuss_first') {
    required.push('memory');
    recoveryPolicy = 'ask_missing_info';
    userVisibleSurface = contract.mode === 'clarify' ? 'plain_chat' : 'light_plan';
  }

  if (contract.mode === 'plan') {
    required.push('planner', 'memory');
    userVisibleSurface = 'light_plan';
  }

  if (contract.mode === 'critical_action') {
    required.push('security');
    userVisibleSurface = 'confirmation';
    mutationPolicy = 'only_after_confirmation';
    recoveryPolicy = 'ask_missing_info';
    if (contract.target_kind === 'publish') publishPolicy = 'confirm_before_publish';
  }

  if (contract.can_mutate_files) {
    required.push('planner', 'tool_loop', 'browser_testing', 'autofix', 'atomic_save', 'recovery', 'preview', 'security', 'memory');
    userVisibleSurface = 'rich_parts_stream';
    mutationPolicy = 'allowed';
    savePolicy = 'atomic_versioned';
    recoveryPolicy = 'autofix_then_draft';
    optional.push('publish');
  }

  if (contract.mode === 'verify') {
    required.push('browser_testing', 'preview', 'security');
    userVisibleSurface = 'rich_parts_stream';
    savePolicy = 'atomic_draft';
  }

  if (contract.infrastructure.includes('vercel') || contract.target_kind === 'publish') {
    required.push('publish', 'security');
    publishPolicy = contract.mode === 'critical_action' ? 'confirm_before_publish' : 'verify_live_after_publish';
  }

  return {
    version: 'execution-sync-matrix/v1',
    mode: contract.mode,
    ai_task: executionContractToAIWorkflowTask(contract),
    required_layers: unique(required),
    optional_layers: unique(optional).filter(layer => !required.includes(layer)),
    evidence_required: unique(contract.evidence_required.concat(contract.can_mutate_files ? [
      'atomic_save',
      'browser_test_result',
      'autofix_or_clean_checks',
    ] : [])),
    user_visible_surface: userVisibleSurface,
    mutation_policy: mutationPolicy,
    save_policy: savePolicy,
    recovery_policy: recoveryPolicy,
    publish_policy: publishPolicy,
    language_policy: 'match_user_language_short',
    no_fake_success: true,
  };
}

function finding(key: string, status: ExecutionSyncFinding['status'], message: string): ExecutionSyncFinding {
  return { key, status, message };
}

export function validateExecutionSync(matrix: ExecutionSyncMatrix, evidence: ExecutionSyncEvidence): ExecutionSyncValidation {
  const findings: ExecutionSyncFinding[] = [];

  if (matrix.mutation_policy === 'never' && evidence.filesChanged) {
    findings.push(finding('unexpected_mutation', 'fail', 'This mode must not change files.'));
  }
  if (matrix.mutation_policy === 'only_after_confirmation' && evidence.filesChanged && !evidence.confirmationRequested) {
    findings.push(finding('missing_confirmation', 'fail', 'Sensitive actions require confirmation before mutation.'));
  }
  if (matrix.user_visible_surface === 'plain_chat' && (evidence.previewReady || evidence.runnerChecked || evidence.browserChecked)) {
    findings.push(finding('plain_chat_side_effects', 'fail', 'Plain chat must not touch preview, runner, or browser testing.'));
  }
  if (matrix.user_visible_surface === 'rich_parts_stream' && matrix.required_layers.includes('browser_testing') && !evidence.browserChecked) {
    findings.push(finding('browser_test_missing', 'warn', 'Project missions should include browser testing evidence.'));
  }
  if (matrix.save_policy === 'atomic_versioned' && evidence.filesChanged && !evidence.versionSaved && !evidence.draftSaved) {
    findings.push(finding('atomic_save_missing', 'fail', 'Mutating work must save a version or recoverable draft.'));
  }
  if (matrix.required_layers.includes('security') && (matrix.mutation_policy !== 'never' || matrix.publish_policy !== 'not_applicable') && !evidence.securityChecked) {
    findings.push(finding('security_check_missing', 'warn', 'Mutating or publish-related work should include security evidence.'));
  }
  if (matrix.publish_policy === 'verify_live_after_publish' && !evidence.liveVerified) {
    findings.push(finding('live_publish_unverified', 'warn', 'Published apps should be verified after deployment.'));
  }
  if (matrix.required_layers.includes('memory') && evidence.filesChanged && !evidence.memoryUpdated) {
    findings.push(finding('memory_not_updated', 'warn', 'Project decisions should be persisted after meaningful work.'));
  }
  if (!findings.length) findings.push(finding('sync_matrix_satisfied', 'pass', 'Execution layers are aligned for this contract.'));

  return {
    status: findings.some(item => item.status === 'fail') ? 'failed' : findings.some(item => item.status === 'warn') ? 'warning' : 'passed',
    findings,
  };
}
