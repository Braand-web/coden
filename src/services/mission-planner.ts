import type { CodenSkillExecutionPlan, CodenSkillAgentRole } from './coden-skill-plan.ts';
import type { MissionComplexity, MissionMode, MissionProfile, MissionRisk, TaskNode } from './coden-v4-contracts.ts';

export type MissionPlanningInput = {
  runId: string;
  prompt: string;
  requestedMode?: string;
  intent?: string;
  complexity?: 'simple' | 'medium' | 'complex' | 'extreme';
  risk?: 'low' | 'medium' | 'high' | 'critical';
  files?: readonly { path: string }[];
  selectedModel: string;
  skillPlan: CodenSkillExecutionPlan;
};

const includes = (value: string, expression: RegExp) => expression.test(value);

function missionMode(input: MissionPlanningInput): MissionMode {
  const value = `${input.intent || ''} ${input.requestedMode || ''}`.toLowerCase();
  if (includes(value, /deploy|publish|release/)) return 'deploy';
  if (includes(value, /fix|debug|repair/)) return 'fix';
  if (includes(value, /plan|architect|research/)) return 'plan';
  if (includes(value, /conversation|ask|chat/)) return 'conversation';
  return 'build';
}

function missionComplexity(value: MissionPlanningInput['complexity']): MissionComplexity {
  if (value === 'simple') return 'trivial';
  if (value === 'complex') return 'complex';
  if (value === 'extreme') return 'critical';
  return 'normal';
}

function missionRisk(value: MissionPlanningInput['risk']): MissionRisk {
  if (value === 'critical') return 'destructive';
  return value || 'medium';
}

function probableFiles(files: MissionPlanningInput['files'], text: string) {
  const candidates = (files || []).map(file => file.path).filter(Boolean);
  const scored = candidates.map(path => {
    const lower = path.toLowerCase();
    let score = 0;
    if (includes(text, /database|supabase|postgres|migration|rls/) && includes(lower, /supabase|migration|schema|database/)) score += 4;
    if (includes(text, /design|ui|ux|page|component|responsive/) && includes(lower, /component|style|css|tsx|html/)) score += 3;
    if (includes(text, /publish|deploy|cloudflare/) && includes(lower, /publish|deploy|cloudflare|wrangler/)) score += 4;
    if (includes(text, /billing|stripe|credit/) && includes(lower, /billing|stripe|credit|usage/)) score += 4;
    if (includes(text, /preview|iframe|render/) && includes(lower, /preview|builder|runner/)) score += 4;
    return { path, score };
  });
  return scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, 24).map(item => item.path);
}

export function buildMissionProfile(input: MissionPlanningInput): MissionProfile {
  const text = input.prompt.toLowerCase();
  const mode = missionMode(input);
  const requiresDatabase = includes(text, /database|base de donn[eé]es|supabase|postgres|sql|migration|rls|crud/);
  const requiresBackend = requiresDatabase || includes(text, /backend|api|server|webhook|function|full[ -]?stack/);
  const requiresAuth = includes(text, /auth|login|signup|connexion|inscription|oauth|permission/);
  const requiresStorage = includes(text, /storage|upload|file|fichier|image|r2|bucket/);
  const requiresPayments = includes(text, /stripe|payment|paiement|billing|facturation|subscription|abonnement|credit/);
  const requiresDesign = includes(text, /design|ui|ux|interface|landing|dashboard|responsive|mobile|typograph|layout|couleur|color|bleu|vert|rouge|blue|green|red/);
  const requiresBrowserQA = mode !== 'conversation' && mode !== 'plan';
  const detectedStack = new Set<string>();
  for (const file of input.files || []) {
    const path = file.path.toLowerCase();
    if (includes(path, /\.tsx?$|package\.json/)) detectedStack.add('TypeScript');
    if (includes(path, /\.tsx$|react/)) detectedStack.add('React');
    if (includes(path, /supabase/)) detectedStack.add('Supabase');
    if (includes(path, /cloudflare|wrangler/)) detectedStack.add('Cloudflare');
  }
  if (requiresDatabase) detectedStack.add('Supabase');
  if (includes(text, /cloudflare|worker|r2/)) detectedStack.add('Cloudflare');
  if (requiresPayments) detectedStack.add('Stripe');

  const expectedCapabilities = [
    requiresBackend && 'backend', requiresDatabase && 'database', requiresAuth && 'auth',
    requiresStorage && 'storage', requiresPayments && 'payments', requiresDesign && 'design',
    requiresBrowserQA && 'browser-qa', mode === 'deploy' && 'deployment',
  ].filter((item): item is string => Boolean(item));
  const successCriteria = mode === 'conversation'
    ? ['The response directly and accurately answers the request.']
    : [
        'The requested behavior is implemented.',
        'The project passes its deterministic build and type checks.',
        ...(requiresBrowserQA ? ['The real preview renders and the primary browser journey passes without a blocking runtime error.'] : []),
        ...(requiresDatabase ? ['Database migrations apply and tenant access policies are verified.'] : []),
        ...(mode === 'deploy' ? ['The production URL and rollback target are verified.'] : []),
      ];

  return {
    intent: input.intent || mode,
    mode,
    complexity: missionComplexity(input.complexity),
    risk: missionRisk(input.risk),
    applicationType: includes(text, /crm/) ? 'crm' : includes(text, /landing/) ? 'landing' : includes(text, /dashboard/) ? 'dashboard' : null,
    detectedStack: [...detectedStack],
    expectedCapabilities,
    requiresBackend,
    requiresDatabase,
    requiresAuth,
    requiresStorage,
    requiresPayments,
    requiresDesign,
    requiresBrowserQA,
    probableFiles: probableFiles(input.files, text),
    ambiguities: [],
    successCriteria,
  };
}

const AGENT_BY_ROLE: Record<CodenSkillAgentRole, string> = {
  master: 'orchestrator', explorer: 'explorer', product: 'planner', architect: 'architect',
  frontend: 'frontend', backend: 'backend', database: 'database', test: 'tester',
  browser: 'visual_qa', reviewer: 'reviewer', release: 'integrator',
};

export function buildMissionTaskGraph(input: MissionPlanningInput, profile = buildMissionProfile(input)): TaskNode[] {
  return input.skillPlan.nodes.map((node, index) => {
    const role = (['database', 'browser', 'release', 'reviewer', 'backend', 'frontend'] as const)
      .find(candidate => node.roles.includes(candidate)) || node.roles[0] || 'master';
    const writes = node.phase === 'implement' || node.phase === 'release';
    const reservations = writes ? profile.probableFiles.filter(path => {
      const lower = path.toLowerCase();
      if (role === 'database') return includes(lower, /supabase|migration|schema|database/);
      if (role === 'frontend') return !includes(lower, /supabase|migration|schema|database|server/);
      return true;
    }) : [];
    return {
      id: `${input.runId}:${node.id}`,
      runId: input.runId,
      kind: node.phase,
      dependencies: node.dependsOn.map(id => `${input.runId}:${id}`),
      assignedAgent: AGENT_BY_ROLE[role],
      selectedModel: input.selectedModel,
      selectedSkills: [...node.skillIds],
      allowedTools: node.phase === 'verify' ? ['filesystem.read', 'terminal.exec', 'browser.inspect'] : writes ? ['filesystem.read', 'filesystem.write', 'terminal.exec'] : ['filesystem.read'],
      fileReservations: [...new Set(reservations)],
      inputArtifacts: index === 0 ? ['mission-profile'] : node.dependsOn.map(id => `${id}:output`),
      expectedOutputs: [`${node.phase}:evidence`],
      acceptanceCriteria: node.skillIds.flatMap(id => {
        const skill = input.skillPlan.selectedSkillIds.includes(id) ? id : null;
        return skill ? [`${skill}:completion`] : [];
      }),
      tokenBudget: profile.complexity === 'critical' ? 32_000 : profile.complexity === 'complex' ? 16_000 : 8_000,
      costBudgetUsd: profile.complexity === 'critical' ? 25 : profile.complexity === 'complex' ? 10 : 3,
      timeoutMs: node.phase === 'release' ? 600_000 : 300_000,
      maxAttempts: node.phase === 'verify' ? 3 : 2,
      status: node.dependsOn.length ? 'pending' : 'ready',
    };
  });
}

export function planMission(input: MissionPlanningInput) {
  const profile = buildMissionProfile(input);
  return { profile, graph: buildMissionTaskGraph(input, profile) };
}
