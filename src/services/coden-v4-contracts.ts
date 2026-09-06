export type MissionMode = 'conversation' | 'plan' | 'build' | 'fix' | 'deploy';
export type MissionComplexity = 'trivial' | 'normal' | 'complex' | 'critical';
export type MissionRisk = 'low' | 'medium' | 'high' | 'destructive';

export type MissionProfile = {
  intent: string;
  mode: MissionMode;
  complexity: MissionComplexity;
  risk: MissionRisk;
  applicationType: string | null;
  detectedStack: string[];
  expectedCapabilities: string[];
  requiresBackend: boolean;
  requiresDatabase: boolean;
  requiresAuth: boolean;
  requiresStorage: boolean;
  requiresPayments: boolean;
  requiresDesign: boolean;
  requiresBrowserQA: boolean;
  probableFiles: string[];
  ambiguities: string[];
  successCriteria: string[];
};

export type TaskNodeStatus = 'pending' | 'ready' | 'running' | 'waiting_user' | 'repairing' | 'passed' | 'failed' | 'cancelled';
export type TaskNode = {
  id: string;
  runId: string;
  kind: string;
  dependencies: string[];
  assignedAgent: string;
  selectedModel: string;
  selectedSkills: string[];
  allowedTools: string[];
  fileReservations: string[];
  inputArtifacts: string[];
  expectedOutputs: string[];
  acceptanceCriteria: string[];
  tokenBudget: number;
  costBudgetUsd: number;
  timeoutMs: number;
  maxAttempts: number;
  status: TaskNodeStatus;
};

export type PreviewStatus = 'empty' | 'provisioning' | 'installing' | 'starting' | 'building' | 'checking' | 'ready' | 'repairing' | 'failed' | 'stopped';

export function canMarkMissionDone(nodes: readonly TaskNode[], requiredEvidence: readonly string[], availableEvidence: readonly string[]) {
  const failed = nodes.some(node => node.status === 'failed' || node.status === 'cancelled' || node.status === 'waiting_user');
  const incomplete = nodes.some(node => node.status !== 'passed');
  const evidence = new Set(availableEvidence);
  const missingEvidence = requiredEvidence.filter(item => !evidence.has(item));
  return { done: !failed && !incomplete && missingEvidence.length === 0, missingEvidence };
}
