import type { AIModelRuntimeConfig } from './ai-model-runtime.ts';
import type { ExecutionContract } from './execution-contract.ts';
import {
  buildExecutionSyncMatrix,
  type ExecutionSyncMatrix,
  validateExecutionSync,
} from './execution-sync-matrix.ts';

export type ProductionReliabilityLayer =
  | 'intent'
  | 'planner'
  | 'tool_loop'
  | 'browser'
  | 'visual'
  | 'autofix'
  | 'atomic_save'
  | 'recovery'
  | 'preview'
  | 'publish'
  | 'security'
  | 'fullstack'
  | 'model_runtime'
  | 'memory'
  | 'observability'
  | 'golden_prompts'
  | 'language';

export type ProductionRequirementSeverity = 'blocker' | 'required' | 'recommended';

export type ProductionReliabilityRequirement = {
  key: string;
  layer: ProductionReliabilityLayer;
  severity: ProductionRequirementSeverity;
  evidenceKey: keyof ProductionReliabilityEvidence | string;
  description: string;
};

export type ProductionReliabilityPlan = {
  version: 'production-reliability-harness/v1';
  mode: ExecutionContract['mode'];
  userVisibleSurface: ExecutionSyncMatrix['user_visible_surface'];
  deliveryPolicy: 'plain_answer' | 'plan_only' | 'verified_project' | 'confirm_first' | 'recoverable_draft';
  requirements: ProductionReliabilityRequirement[];
  goldenPromptsRequired: boolean;
  noFakeSuccess: true;
};

export type ProductionReliabilityEvidence = {
  intentDecided?: boolean;
  executionContractBuilt?: boolean;
  modelRuntimeConfigured?: boolean;
  selectedModelRespected?: boolean;
  fallbackConfigured?: boolean;
  structuredOutputConfigured?: boolean;
  toolCallingConfigured?: boolean;
  reasoningConfigured?: boolean;
  visionConfigured?: boolean;
  longContextConfigured?: boolean;
  plannerInternal?: boolean;
  toolLoopTrace?: boolean;
  filesChanged?: boolean;
  diffReady?: boolean;
  runnerChecked?: boolean;
  runnerStatus?: 'passed' | 'warning' | 'failed' | 'skipped';
  browserChecked?: boolean;
  browserStatus?: 'passed' | 'warning' | 'failed' | 'skipped';
  visualChecked?: boolean;
  visualStatus?: 'passed' | 'warning' | 'failed' | 'skipped';
  autoFixAttempted?: boolean;
  autoFixSucceeded?: boolean;
  cleanChecks?: boolean;
  previewReady?: boolean;
  previewStatus?: 'ready' | 'building' | 'failed' | 'needs_fix' | 'idle';
  draftSaved?: boolean;
  versionSaved?: boolean;
  journalPersisted?: boolean;
  recoveryAvailable?: boolean;
  confirmationRequested?: boolean;
  livePublished?: boolean;
  liveUrlPersisted?: boolean;
  liveVerified?: boolean;
  securityChecked?: boolean;
  securityStatus?: 'passed' | 'warning' | 'failed' | 'skipped';
  memoryUpdated?: boolean;
  languageMatched?: boolean;
  noRawJsonDisplayed?: boolean;
  noCodeInChat?: boolean;
  noSecrets?: boolean;
  observabilityRecorded?: boolean;
  goldenPromptCovered?: boolean;
  fullstackSchemaGenerated?: boolean;
  rlsEnabled?: boolean;
  policiesGenerated?: boolean;
  authGuardsGenerated?: boolean;
  validationGenerated?: boolean;
  ownerScopeGenerated?: boolean;
  noFakeLocalStorage?: boolean;
};

export type ProductionReliabilityFinding = {
  key: string;
  status: 'pass' | 'warn' | 'fail';
  layer: ProductionReliabilityLayer;
  message: string;
};

export type ProductionReliabilityValidation = {
  status: 'passed' | 'warning' | 'needs_fix' | 'failed';
  findings: ProductionReliabilityFinding[];
  missingBlockers: string[];
  nextAction: 'deliver' | 'save_recoverable_draft' | 'ask_user' | 'run_more_checks' | 'block';
};

const BASE_REQUIREMENTS: ProductionReliabilityRequirement[] = [
  requirement('intent_decided', 'intent', 'blocker', 'intentDecided', 'Intent must be classified before any answer or action.'),
  requirement('execution_contract', 'intent', 'blocker', 'executionContractBuilt', 'Execution Contract must be built before routing.'),
  requirement('model_runtime', 'model_runtime', 'required', 'modelRuntimeConfigured', 'Selected model must have a runtime capability profile.'),
  requirement('selected_model_locked', 'model_runtime', 'required', 'selectedModelRespected', 'The selected model must remain locked for the run; changing models requires an explicit new run.'),
  requirement('language_match', 'language', 'recommended', 'languageMatched', 'The assistant should answer in the user language.'),
  requirement('no_raw_json', 'language', 'blocker', 'noRawJsonDisplayed', 'Raw JSON plans or provider payloads must not be shown to users.'),
  requirement('observability', 'observability', 'recommended', 'observabilityRecorded', 'Runs should record latency, status, model and failure class.'),
];

const PROJECT_REQUIREMENTS: ProductionReliabilityRequirement[] = [
  requirement('planner_internal', 'planner', 'required', 'plannerInternal', 'Build/edit/debug missions need an internal plan that is not dumped into chat.'),
  requirement('tool_loop_trace', 'tool_loop', 'required', 'toolLoopTrace', 'Tool loop must leave a trace of read/write/check/fix operations.'),
  requirement('file_diff', 'tool_loop', 'blocker', 'diffReady', 'Mutating work needs a diff or file edit summary.'),
  requirement('runner_result', 'browser', 'blocker', 'runnerChecked', 'Runner checks must run before a project mission is delivered.'),
  requirement('browser_test', 'browser', 'blocker', 'browserChecked', 'Browser interaction test must inspect generated apps.'),
  requirement('visual_inspection', 'visual', 'required', 'visualChecked', 'Visual inspection should check blank previews, overflow and obvious UI breakage.'),
  requirement('autofix_or_clean', 'autofix', 'blocker', 'cleanChecks', 'Blocking findings must either be clean or auto-fixed and retested.'),
  requirement('preview_ready', 'preview', 'blocker', 'previewReady', 'Preview can be marked ready only after real preview evidence.'),
  requirement('atomic_save', 'atomic_save', 'blocker', 'versionSaved', 'Successful mutations need atomic version save.'),
  requirement('recoverable_draft', 'recovery', 'blocker', 'recoveryAvailable', 'Failed mutations need a recoverable draft and recovery path.'),
  requirement('journal_persisted', 'recovery', 'required', 'journalPersisted', 'The work journal should survive refresh and reconnect.'),
  requirement('security_scan', 'security', 'required', 'securityChecked', 'Generated code should pass the generated security scanner.'),
  requirement('memory_update', 'memory', 'recommended', 'memoryUpdated', 'Meaningful project decisions should update safe memory.'),
  requirement('no_code_in_chat', 'language', 'blocker', 'noCodeInChat', 'Generated application code belongs in files/preview, not chat prose.'),
];

const FULLSTACK_REQUIREMENTS: ProductionReliabilityRequirement[] = [
  requirement('schema_generated', 'fullstack', 'blocker', 'fullstackSchemaGenerated', 'Data apps need a Supabase/Postgres schema contract.'),
  requirement('rls_enabled', 'fullstack', 'blocker', 'rlsEnabled', 'Private tables need row-level security enabled.'),
  requirement('policies_generated', 'fullstack', 'blocker', 'policiesGenerated', 'Private tables need explicit RLS policies.'),
  requirement('owner_scope', 'fullstack', 'blocker', 'ownerScopeGenerated', 'User data needs owner_id or organization_id scoping.'),
  requirement('auth_guards', 'fullstack', 'blocker', 'authGuardsGenerated', 'Private routes and data actions need auth guards.'),
  requirement('validation_layer', 'fullstack', 'blocker', 'validationGenerated', 'Sensitive data actions need validation.'),
  requirement('no_fake_localstorage', 'fullstack', 'blocker', 'noFakeLocalStorage', 'Real private data must not rely on localStorage as production persistence.'),
  requirement('no_secrets', 'security', 'blocker', 'noSecrets', 'Secrets and service-role keys must never be generated into frontend files.'),
];

const PUBLISH_REQUIREMENTS: ProductionReliabilityRequirement[] = [
  requirement('publish_confirmation', 'publish', 'blocker', 'confirmationRequested', 'Publish/deploy needs explicit confirmation.'),
  requirement('live_url_persisted', 'publish', 'blocker', 'liveUrlPersisted', 'Live URL should be stored only after a successful deployment.'),
  requirement('live_verified', 'publish', 'blocker', 'liveVerified', 'Published URL must be verified after deployment.'),
];

export const PRODUCTION_GOLDEN_PROMPTS = [
  'bonjour',
  'dis-moi ce que tu peux faire',
  'cree une mini app todo avec ajout, suppression, filtres et localStorage',
  'corrige preview blanche: index.html should load /src/main.tsx as a module',
  'cree une app SaaS avec auth Supabase, base de donnees et RLS',
  'publie cette app',
] as const;

function requirement(
  key: string,
  layer: ProductionReliabilityLayer,
  severity: ProductionRequirementSeverity,
  evidenceKey: ProductionReliabilityRequirement['evidenceKey'],
  description: string,
): ProductionReliabilityRequirement {
  return { key, layer, severity, evidenceKey, description };
}

function uniqueRequirements(items: ProductionReliabilityRequirement[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

function needsFullstack(contract: ExecutionContract) {
  return contract.infrastructure.some(item => ['supabase', 'database', 'auth', 'stripe', 'storage', 'api'].includes(item))
    || contract.target_kind === 'backend';
}

export function buildProductionReliabilityPlan(input: {
  contract: ExecutionContract;
  syncMatrix?: ExecutionSyncMatrix;
}): ProductionReliabilityPlan {
  const { contract } = input;
  const syncMatrix = input.syncMatrix || buildExecutionSyncMatrix(contract);
  const requirements = [...BASE_REQUIREMENTS];

  let deliveryPolicy: ProductionReliabilityPlan['deliveryPolicy'] = 'plain_answer';
  if (syncMatrix.user_visible_surface === 'light_plan') deliveryPolicy = 'plan_only';
  if (syncMatrix.user_visible_surface === 'confirmation') deliveryPolicy = 'confirm_first';
  if (syncMatrix.user_visible_surface === 'rich_parts_stream') {
    deliveryPolicy = contract.mode === 'debug' ? 'recoverable_draft' : 'verified_project';
    requirements.push(...PROJECT_REQUIREMENTS);
  }
  if (needsFullstack(contract)) requirements.push(...FULLSTACK_REQUIREMENTS);
  if (syncMatrix.publish_policy !== 'not_applicable') requirements.push(...PUBLISH_REQUIREMENTS);

  if (contract.model_workflow.structured_output) {
    requirements.push(requirement('structured_output_config', 'model_runtime', 'required', 'structuredOutputConfigured', 'Structured decisions should use provider-supported structured output or a safe fallback parser.'));
  }
  if (contract.model_workflow.tool_calling) {
    requirements.push(requirement('tool_calling_config', 'model_runtime', 'required', 'toolCallingConfigured', 'Tool-capable workflows should load tool definitions when the selected provider supports them.'));
  }
  if (contract.model_workflow.vision) {
    requirements.push(requirement('vision_config', 'model_runtime', 'required', 'visionConfigured', 'Vision workflows should enable screenshot/image handling when supported.'));
  }
  if (contract.model_workflow.long_context) {
    requirements.push(requirement('long_context_config', 'model_runtime', 'required', 'longContextConfigured', 'Large project workflows should use long-context strategy when supported.'));
  }

  return {
    version: 'production-reliability-harness/v1',
    mode: contract.mode,
    userVisibleSurface: syncMatrix.user_visible_surface,
    deliveryPolicy,
    requirements: uniqueRequirements(requirements),
    goldenPromptsRequired: contract.can_mutate_files || contract.mode === 'debug' || contract.mode === 'verify',
    noFakeSuccess: true,
  };
}
function evidenceValue(evidence: ProductionReliabilityEvidence, key: ProductionReliabilityRequirement['evidenceKey']) {
  return (evidence as Record<string, unknown>)[String(key)];
}

function statusIsBad(value: unknown) {
  return value === 'failed' || value === 'needs_fix';
}

function isRequirementSatisfied(requirement: ProductionReliabilityRequirement, evidence: ProductionReliabilityEvidence) {
  if (requirement.key === 'autofix_or_clean') {
    return Boolean(evidence.cleanChecks || evidence.autoFixSucceeded);
  }
  if (requirement.key === 'recoverable_draft') {
    if (evidence.previewStatus === 'failed' || evidence.previewStatus === 'needs_fix' || evidence.runnerStatus === 'failed' || evidence.browserStatus === 'failed') {
      return Boolean(evidence.draftSaved || evidence.versionSaved || evidence.recoveryAvailable);
    }
    return true;
  }
  return Boolean(evidenceValue(evidence, requirement.evidenceKey));
}

function runtimeEvidenceFromConfig(contract: ExecutionContract, config?: AIModelRuntimeConfig): ProductionReliabilityEvidence {
  if (!config) return {};
  return {
    modelRuntimeConfigured: true,
    selectedModelRespected: true,
    fallbackConfigured: false,
    structuredOutputConfigured: !contract.model_workflow.structured_output
      || config.responseFormat.type !== 'text'
      || !config.profile.supports.structuredOutput,
    toolCallingConfigured: !contract.model_workflow.tool_calling
      || config.tools.length > 0
      || !config.profile.supports.toolCalling,
    reasoningConfigured: !contract.model_workflow.reasoning
      || config.reasoning.enabled
      || !config.profile.supports.reasoningControl,
    visionConfigured: !contract.model_workflow.vision
      || config.vision.enabled
      || !config.profile.supports.vision,
    longContextConfigured: !contract.model_workflow.long_context
      || config.longContext.enabled
      || !config.profile.supports.longContext,
  };
}

function finding(
  key: string,
  status: ProductionReliabilityFinding['status'],
  layer: ProductionReliabilityLayer,
  message: string,
): ProductionReliabilityFinding {
  return { key, status, layer, message };
}

export function validateProductionReliability(input: {
  contract: ExecutionContract;
  syncMatrix?: ExecutionSyncMatrix;
  plan?: ProductionReliabilityPlan;
  evidence?: ProductionReliabilityEvidence;
  modelRuntime?: AIModelRuntimeConfig;
}): ProductionReliabilityValidation {
  const syncMatrix = input.syncMatrix || buildExecutionSyncMatrix(input.contract);
  const plan = input.plan || buildProductionReliabilityPlan({ contract: input.contract, syncMatrix });
  const evidence: ProductionReliabilityEvidence = {
    ...runtimeEvidenceFromConfig(input.contract, input.modelRuntime),
    ...(input.evidence || {}),
  };
  const findings: ProductionReliabilityFinding[] = [];

  const syncValidation = validateExecutionSync(syncMatrix, {
    filesChanged: evidence.filesChanged,
    previewReady: evidence.previewReady,
    runnerChecked: evidence.runnerChecked,
    browserChecked: evidence.browserChecked,
    draftSaved: evidence.draftSaved,
    versionSaved: evidence.versionSaved,
    confirmationRequested: evidence.confirmationRequested,
    liveVerified: evidence.liveVerified,
    securityChecked: evidence.securityChecked,
    memoryUpdated: evidence.memoryUpdated,
  });
  for (const item of syncValidation.findings) {
    findings.push(finding(`sync_${item.key}`, item.status, 'intent', item.message));
  }

  for (const item of plan.requirements) {
    const satisfied = isRequirementSatisfied(item, evidence);
    if (satisfied) {
      findings.push(finding(item.key, 'pass', item.layer, item.description));
      continue;
    }
    findings.push(finding(
      item.key,
      item.severity === 'recommended' ? 'warn' : 'fail',
      item.layer,
      item.description,
    ));
  }

  for (const [key, layer] of [
    ['runnerStatus', 'browser'],
    ['browserStatus', 'browser'],
    ['visualStatus', 'visual'],
    ['securityStatus', 'security'],
  ] as const) {
    if (statusIsBad(evidence[key])) {
      findings.push(finding(`${key}_failed`, 'fail', layer, `${key} is failed; Coden must fix, retest, or save a recoverable draft.`));
    }
  }

  if (evidence.previewReady && (evidence.previewStatus === 'failed' || evidence.previewStatus === 'needs_fix')) {
    findings.push(finding('fake_preview_ready', 'fail', 'preview', 'Preview ready cannot be true while preview status is failed or needs_fix.'));
  }

  if (plan.goldenPromptsRequired && evidence.goldenPromptCovered !== true) {
    findings.push(finding('golden_prompt_missing', 'warn', 'golden_prompts', 'This class of mission should be covered by a golden prompt regression test.'));
  }

  const missingBlockers = findings
    .filter(item => item.status === 'fail')
    .map(item => item.key);
  const hasRecoverableDraft = Boolean(evidence.draftSaved || evidence.versionSaved || evidence.recoveryAvailable);
  const hasFailedRuntime = Boolean(
    evidence.previewStatus === 'failed'
    || evidence.previewStatus === 'needs_fix'
    || evidence.runnerStatus === 'failed'
    || evidence.browserStatus === 'failed'
    || evidence.visualStatus === 'failed'
    || evidence.securityStatus === 'failed',
  );
  const needsFix = hasFailedRuntime && hasRecoverableDraft;
  const status: ProductionReliabilityValidation['status'] = missingBlockers.length
    ? needsFix ? 'needs_fix' : 'failed'
    : findings.some(item => item.status === 'warn') ? 'warning' : 'passed';

  return {
    status,
    findings,
    missingBlockers,
    nextAction: status === 'passed' || status === 'warning'
      ? 'deliver'
      : status === 'needs_fix'
        ? 'save_recoverable_draft'
        : input.contract.requires_confirmation
          ? 'ask_user'
          : input.contract.can_mutate_files
            ? 'run_more_checks'
            : 'block',
  };
}
