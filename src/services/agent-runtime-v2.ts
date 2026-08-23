import { randomUUID } from 'node:crypto';
import { AI_MODEL_CAPABILITIES, isAllowedModelId, type AllowedModelId } from '../config/ai-models.ts';

export type AgentRunState =
  | 'ready'
  | 'understanding'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'verified'
  | 'needs_fix'
  | 'failed'
  | 'cancelled';

export type AgentAction = 'answer' | 'clarify' | 'plan' | 'build' | 'edit' | 'debug' | 'confirm';

export type VerifiedFactType =
  | 'file_created'
  | 'file_modified'
  | 'file_deleted'
  | 'build_passed'
  | 'test_passed'
  | 'preview_verified'
  | 'route_verified'
  | 'browser_check_passed'
  | 'deployment_verified'
  | 'credit_charged'
  | 'error_detected';

export type VerifiedFactSource = 'filesystem' | 'build' | 'preview' | 'browser' | 'cloudflare' | 'billing';

export type VerifiedFact = {
  id: string;
  runId: string;
  type: VerifiedFactType;
  value: unknown;
  source: VerifiedFactSource;
  verifiedAt: string;
  evidence?: string;
};

export type VerifiedFactLedger = {
  runId: string;
  facts: VerifiedFact[];
  status: 'complete' | 'incomplete' | 'failed';
};

export type AgentObjective = {
  goal: string;
  scope: { included: string[]; excluded: string[] };
  constraints: string[];
  assumptions: string[];
  acceptanceCriteria: string[];
  risk: 'low' | 'medium' | 'high' | 'critical';
};

export type ModelDecision = {
  action: AgentAction;
  confidence: number;
  objective: AgentObjective;
  requiredCapabilities: string[];
  clarification?: { question: string; options?: string[] };
};

export type AgentModelCapabilities = {
  streaming: boolean;
  structuredOutput: boolean;
  toolCalling: boolean;
};

export class AgentRuntimeValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentRuntimeValidationError';
    this.code = code;
  }
}

const ACTIONS = new Set<AgentAction>(['answer', 'clarify', 'plan', 'build', 'edit', 'debug', 'confirm']);
const RISKS = new Set<AgentObjective['risk']>(['low', 'medium', 'high', 'critical']);

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => !nonEmptyString(item))) {
    throw new AgentRuntimeValidationError('INVALID_DECISION', `${field} must be a non-empty string array.`);
  }
  return value.map(item => String(item).trim());
}

export function createAgentRunId() {
  return `run_${randomUUID()}`;
}

export function createFactLedger(runId: string): VerifiedFactLedger {
  return { runId, facts: [], status: 'incomplete' };
}

export function appendVerifiedFact(ledger: VerifiedFactLedger, input: Omit<VerifiedFact, 'id' | 'runId' | 'verifiedAt'>): VerifiedFact {
  const fact: VerifiedFact = {
    ...input,
    id: `fact_${randomUUID()}`,
    runId: ledger.runId,
    verifiedAt: new Date().toISOString(),
  };
  ledger.facts.push(fact);
  return fact;
}

export function finalizeFactLedger(ledger: VerifiedFactLedger, status: VerifiedFactLedger['status']): VerifiedFactLedger {
  ledger.status = status;
  return ledger;
}

export function hasVerifiedFact(ledger: VerifiedFactLedger, type: VerifiedFactType) {
  return ledger.facts.some(fact => fact.type === type);
}

export function isVerifiedFactLedgerComplete(ledger: VerifiedFactLedger) {
  return ledger.status === 'complete' && ledger.facts.every(fact => Boolean(fact.id && fact.runId && fact.verifiedAt));
}

export function validateModelDecision(value: unknown): ModelDecision {
  if (!value || typeof value !== 'object') {
    throw new AgentRuntimeValidationError('INVALID_DECISION', 'The model returned no structured decision.');
  }
  const raw = value as Record<string, unknown>;
  if (!ACTIONS.has(raw.action as AgentAction)) {
    throw new AgentRuntimeValidationError('INVALID_DECISION', 'The model returned an unsupported action.');
  }
  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) {
    throw new AgentRuntimeValidationError('INVALID_DECISION', 'The model returned an invalid confidence value.');
  }
  const objective = raw.objective;
  if (!objective || typeof objective !== 'object') {
    throw new AgentRuntimeValidationError('INVALID_DECISION', 'The model returned no execution objective.');
  }
  const rawObjective = objective as Record<string, unknown>;
  if (!nonEmptyString(rawObjective.goal) || !RISKS.has(rawObjective.risk as AgentObjective['risk'])) {
    throw new AgentRuntimeValidationError('INVALID_DECISION', 'The model objective is incomplete.');
  }
  const normalized: ModelDecision = {
    action: raw.action as AgentAction,
    confidence: raw.confidence,
    objective: {
      goal: String(rawObjective.goal).trim(),
      scope: {
        included: stringArray((rawObjective.scope as any)?.included, 'objective.scope.included'),
        excluded: stringArray((rawObjective.scope as any)?.excluded, 'objective.scope.excluded'),
      },
      constraints: stringArray(rawObjective.constraints, 'objective.constraints'),
      assumptions: stringArray(rawObjective.assumptions, 'objective.assumptions'),
      acceptanceCriteria: stringArray(rawObjective.acceptanceCriteria, 'objective.acceptanceCriteria'),
      risk: rawObjective.risk as AgentObjective['risk'],
    },
    requiredCapabilities: stringArray(raw.requiredCapabilities, 'requiredCapabilities'),
  };
  if (normalized.action === 'clarify' || normalized.action === 'confirm') {
    const clarification = raw.clarification;
    if (!clarification || typeof clarification !== 'object' || !nonEmptyString((clarification as any).question)) {
      throw new AgentRuntimeValidationError('INVALID_DECISION', 'Clarification or confirmation requires a question.');
    }
    normalized.clarification = {
      question: String((clarification as any).question).trim(),
      options: Array.isArray((clarification as any).options)
        ? (clarification as any).options.filter(nonEmptyString).map((item: string) => item.trim()).slice(0, 4)
        : undefined,
    };
  }
  return normalized;
}

export function getAgentModelCapabilities(modelId: string): AgentModelCapabilities {
  if (!isAllowedModelId(modelId)) {
    throw new AgentRuntimeValidationError('MODEL_NOT_ALLOWED', 'The selected model is not allowed for Coden agent runs.');
  }
  const capabilities = AI_MODEL_CAPABILITIES[modelId as AllowedModelId];
  return {
    streaming: capabilities.supportsStreaming,
    structuredOutput: capabilities.supportsStructuredOutput,
    toolCalling: capabilities.supportsToolCalling,
  };
}

export function assertAgentModelCapabilities(modelId: string, required: Partial<AgentModelCapabilities> = {}) {
  const capabilities = getAgentModelCapabilities(modelId);
  if (required.streaming && !capabilities.streaming) throw new AgentRuntimeValidationError('MODEL_CAPABILITY_MISSING', 'The selected model does not support streaming.');
  if (required.structuredOutput && !capabilities.structuredOutput) throw new AgentRuntimeValidationError('MODEL_CAPABILITY_MISSING', 'The selected model does not support structured output.');
  if (required.toolCalling && !capabilities.toolCalling) throw new AgentRuntimeValidationError('MODEL_CAPABILITY_MISSING', 'The selected model does not support tool calling.');
  return capabilities;
}

export function canPublishFromVerification(status: string | null | undefined) {
  return status === 'verified';
}

const FACT_BACKED_CLAIMS: Array<{ fact: VerifiedFactType; pattern: RegExp; label: string }> = [
  { fact: 'preview_verified', pattern: /\b(?:preview|prévisualisation|prévisualiser)\s+(?:is|est|sera)\s+(?:ready|prête|prêt|verified|vérifiée|vérifié)\b/i, label: 'preview readiness' },
  { fact: 'deployment_verified', pattern: /\b(?:published|deployed|live|published online|publiée|publié|déployée|déployé|en ligne)\b/i, label: 'deployment' },
  { fact: 'build_passed', pattern: /\b(?:build|compilation)\s+(?:passed|passent|réussit|réussi|succeeded|success(?:ful)?)\b/i, label: 'build success' },
  { fact: 'test_passed', pattern: /\btests?\s+(?:passed|passent|réussit|réussi|réussis|succeeded|success(?:ful)?)\b/i, label: 'test success' },
];

/**
 * Detects positive claims that cannot be supported by the server fact ledger.
 * This is intentionally a narrow contradiction check, not a local response
 * generator: the model still writes the response, while the server prevents
 * an unverified success claim from reaching the user.
 */
export function responseContradictions(text: string, ledger: VerifiedFactLedger): string[] {
  const source = String(text || '').trim();
  if (!source) return ['empty final response'];
  return FACT_BACKED_CLAIMS
    .filter(claim => {
      const match = claim.pattern.exec(source);
      if (!match || hasVerifiedFact(ledger, claim.fact)) return false;
      const before = source.slice(Math.max(0, (match.index || 0) - 32), match.index || 0);
      return !/(?:\bnot|\bnever|\bno|\bwithout|\bpas|\bnon|\bsans|n['’]est\s+pas)\s*$/i.test(before);
    })
    .map(claim => claim.label);
}
