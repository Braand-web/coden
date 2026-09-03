import type { ExecutionContract } from './execution-contract.ts';
import { normalizeExecutionText } from './execution-contract.ts';
import { buildExecutionSyncMatrix } from './execution-sync-matrix.ts';

export type ExecutionPhase =
  | 'idle'
  | 'deciding'
  | 'planning'
  | 'executing'
  | 'checking'
  | 'fixing'
  | 'ready'
  | 'needs_fix'
  | 'blocked';

export type ExecutionDisciplineFinding = {
  key: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
};

export type ExecutionOutputValidation = {
  status: 'passed' | 'warning' | 'failed';
  findings: ExecutionDisciplineFinding[];
};

type ReliabilityLike = {
  status?: string;
  message?: string;
  blocking?: Array<{ message?: string; file?: string | null; source?: string }>;
  failed?: Array<{ message?: string; file?: string | null; source?: string }>;
  warnings?: Array<{ message?: string; file?: string | null; source?: string }>;
};

function speaksFrench(value: string) {
  const text = normalizeExecutionText(value);
  return /\b(le|la|les|un|une|des|je|tu|vous|mon|ma|mes|dans|avec|pour|corrige|cree|genere|publie|ajoute|supprime|application|tache|taches)\b/.test(text);
}

function stripMarkdownJsonFence(value: string) {
  return String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function tryParseJsonObject(value: string): Record<string, any> | null {
  const stripped = stripMarkdownJsonFence(value);
  if (!stripped.startsWith('{') || !stripped.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(stripped);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function looksLikeRawPlanObject(value: string) {
  const raw = String(value || '').toLowerCase();
  const text = normalizeExecutionText(value);
  return (raw.includes('"status"') || text.includes('status'))
    && (
      raw.includes('"plan"')
      || raw.includes('"steps"')
      || raw.includes('"target_files"')
      || raw.includes('"next_action"')
      || text.includes('plan')
      || text.includes('steps')
      || text.includes('target files')
      || text.includes('next action')
    );
}

function planStepsFromJson(raw: Record<string, any>) {
  const plan = raw.plan && typeof raw.plan === 'object' ? raw.plan : raw;
  const rawSteps = Array.isArray(plan.steps) ? plan.steps : Array.isArray(raw.steps) ? raw.steps : [];
  return rawSteps
    .map((step: any, index: number) => {
      if (typeof step === 'string') return `${index + 1}. ${step}`;
      const title = String(step?.phase || step?.title || step?.name || `Step ${index + 1}`).trim();
      const details = String(step?.details || step?.description || step?.task || '').trim();
      return `${index + 1}. ${title}${details ? `: ${details}` : ''}`;
    })
    .filter(Boolean);
}

function formatPlanObject(raw: Record<string, any>, prompt: string) {
  const fr = speaksFrench(prompt);
  const plan = raw.plan && typeof raw.plan === 'object' ? raw.plan : raw;
  const title = String(plan.title || raw.title || (fr ? 'Plan propose' : 'Proposed plan')).trim();
  const steps = planStepsFromJson(raw);
  const nextAction = String(plan.next_action || raw.next_action || '').trim();
  return [
    title,
    '',
    ...(steps.length ? steps : [fr ? '1. Clarifier le resultat attendu.' : '1. Clarify the expected result.']),
    nextAction ? '' : null,
    nextAction ? (fr ? `Prochaine action: ${nextAction}` : `Next action: ${nextAction}`) : null,
  ].filter(Boolean).join('\n');
}

function collapseDuplicateParagraphs(value: string) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const paragraph of String(value || '').split(/\n{2,}/)) {
    const normalized = normalizeExecutionText(paragraph);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(paragraph.trim());
  }
  return output.join('\n\n');
}

function looksLikeInternalRecoveryText(value: string) {
  const text = normalizeExecutionText(value);
  return /\b(draft recuperable|recoverable draft|coden stopped before saving|blocking issue|blocking issues|points bloquants|blocage restant|forced runtime failure marker|preview contains a known forced runtime failure marker|task app must support|commerce app must include|technical build score|changes 0 created|verification coden stopped)\b/i.test(text);
}

function removeFalseCompletionClaims(value: string, contract?: ExecutionContract) {
  if (!contract?.can_mutate_files) return value;
  return String(value || '')
    .replace(/^\s*Work complete\.\s*$/gim, '')
    .replace(/^\s*Traitement termine\.\s*$/gim, '')
    .replace(/^\s*Done\.\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeAssistantOutput(input: {
  text: string;
  prompt: string;
  contract?: ExecutionContract;
  intent?: string;
}) {
  const text = String(input.text || '').trim();
  if (!text) return text;
  const contract = input.contract;
  const fr = speaksFrench(input.prompt);
  const parsed = tryParseJsonObject(text);

  if (parsed && looksLikeRawPlanObject(text)) {
    if (contract?.can_mutate_files) {
      return fr
        ? 'Je garde le plan en interne et je passe a l execution. Je modifierai seulement les fichiers necessaires, puis je verifierai la preview.'
        : 'I am keeping the plan internal and moving to execution. I will only touch the necessary files, then verify the preview.';
    }
    return formatPlanObject(parsed, input.prompt);
  }

  if (looksLikeRawPlanObject(text) && contract?.can_mutate_files) {
    return fr
      ? 'Je garde le plan en interne et je passe a l execution. Je verifierai la preview avant de livrer.'
      : 'I am keeping the plan internal and moving to execution. I will verify the preview before delivery.';
  }

  if (looksLikeInternalRecoveryText(text)) {
    return buildRecoverableDraftMessage({ prompt: input.prompt });
  }

  return collapseDuplicateParagraphs(removeFalseCompletionClaims(text, contract));
}

export function shouldDeliverRecoverableDraft(summary?: ReliabilityLike) {
  return String(summary?.status || '').toLowerCase() === 'failed';
}

export function buildRecoverableDraftMessage(input: {
  prompt: string;
  reliabilitySummary?: ReliabilityLike;
  blockingCount?: number;
}) {
  const fr = speaksFrench(input.prompt);
  if (fr) return 'Je garde le travail en securite. La preview sera affichee seulement apres une verification propre.';
  return 'I kept the work safe. The preview will only be shown after a clean verification.';
}

export function buildInternalExecutionPlan(input: {
  contract: ExecutionContract;
  prompt: string;
  hasExistingFiles?: boolean;
}) {
  const { contract } = input;
  const syncMatrix = buildExecutionSyncMatrix(contract);
  const phases: ExecutionPhase[] = contract.can_mutate_files
    ? ['deciding', 'planning', 'executing', 'checking', 'fixing', 'ready']
    : contract.requires_clarification
      ? ['deciding', 'blocked']
      : ['deciding', 'ready'];

  return {
    version: 'agent-execution-os/v1',
    mode: contract.mode,
    action: contract.action,
    target_kind: contract.target_kind,
    autonomy: contract.requires_confirmation ? 'confirm_first' : contract.can_mutate_files ? 'bounded_execution' : 'answer_only',
    has_existing_files: Boolean(input.hasExistingFiles),
    phases,
    evidence_required: contract.evidence_required,
    prohibited_outputs: contract.prohibited_outputs,
    quality_gate: contract.quality_gate,
    sync_matrix: syncMatrix,
    required_layers: syncMatrix.required_layers,
    user_visible_surface: syncMatrix.user_visible_surface,
    save_policy: syncMatrix.save_policy,
    recovery_policy: syncMatrix.recovery_policy,
    user_visible: false,
  };
}

export function validateExecutionOutputContract(input: {
  contract?: ExecutionContract;
  hasFiles?: boolean;
  previewReady?: boolean;
  runnerChecked?: boolean;
  reliabilityStatus?: string;
  draftSaved?: boolean;
  assistantText?: string;
}) {
  const findings: ExecutionDisciplineFinding[] = [];
  const contract = input.contract;
  const fail = (key: string, message: string) => findings.push({ key, status: 'fail', message });
  const warn = (key: string, message: string) => findings.push({ key, status: 'warn', message });

  if (contract?.can_mutate_files && !input.hasFiles) {
    fail('missing_files', 'A build/edit/debug action must produce or preserve project files.');
  }
  if (contract?.should_touch_preview && input.previewReady && input.reliabilityStatus === 'failed') {
    fail('fake_preview_ready', 'Preview ready cannot be emitted while reliability is failed.');
  }
  if (contract?.requires_runner && input.previewReady && !input.runnerChecked) {
    warn('runner_not_confirmed', 'Preview was delivered without a confirmed runner/browser check.');
  }
  if (input.reliabilityStatus === 'failed' && !input.draftSaved) {
    fail('failed_without_draft', 'A failed reliability gate must save a recoverable draft or block safely.');
  }
  if (input.assistantText && looksLikeRawPlanObject(input.assistantText)) {
    fail('raw_json_plan', 'Raw plan JSON must not be displayed to users.');
  }

  return {
    status: findings.some(item => item.status === 'fail') ? 'failed' : findings.some(item => item.status === 'warn') ? 'warning' : 'passed',
    findings,
  } satisfies ExecutionOutputValidation;
}

export const GOLDEN_EXECUTION_PROMPTS = [
  { prompt: 'bonjour', expectedMode: 'chat', shouldMutate: false },
  { prompt: 'dis-moi c est quoi lovable.dev ?', expectedMode: 'chat', shouldMutate: false },
  { prompt: 'genere', expectedMode: 'clarify', shouldMutate: false },
  {
    prompt: 'cree une vraie todo app web avec ajout de tache, suppression, filtres active completed, compteur, et localStorage',
    expectedMode: 'build',
    shouldMutate: true,
  },
  {
    prompt: 'corrige le probleme: index.html should load /src/main.tsx as a module et la preview ne s affiche pas',
    expectedMode: 'debug',
    shouldMutate: true,
  },
  { prompt: 'publie maintenant', expectedMode: 'critical_action', shouldMutate: false },
] as const;
