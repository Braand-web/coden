/**
 * Coden native skill registry.
 *
 * Skills are runtime policies, not prompt snippets copied from an external
 * agent.  They describe the safe operating envelope for a run: intent
 * matching, tools, approval, verification and cost limits.
 */

export type CodenSkillId =
  | 'build'
  | 'debug'
  | 'review'
  | 'security'
  | 'test'
  | 'research'
  | 'orchestrate'
  | 'release'
  | 'automate'
  | 'onboarding';

export type CodenApprovalPolicy = 'automatic' | 'confirmation' | 'blocked';

export type CodenSkillBudget = {
  maxTokens: number;
  maxToolSteps: number;
  maxDurationMs: number;
  maxRetries: number;
};

export type CodenSkill = {
  id: CodenSkillId;
  version: string;
  description: string;
  intents: string[];
  capabilities: string[];
  allowedTools: string[];
  approvalPolicy: CodenApprovalPolicy;
  budget: CodenSkillBudget;
  requiresVerification: boolean;
};

export type CodenSkillFeatureFlags = {
  skills: boolean;
  workflows: boolean;
  subagents: boolean;
  scheduledRuns: boolean;
};

export type CodenSkillResolutionInput = {
  prompt?: string;
  intent?: string;
  requestedMode?: string;
  risk?: 'low' | 'medium' | 'high' | 'critical';
  plan?: string;
};

export type CodenSkillResolution = {
  skill: CodenSkill;
  confidence: number;
  reason: string;
  requiresConfirmation: boolean;
  blocked: boolean;
};

const PROJECT_READ_TOOLS = ['read_file', 'run_check', 'inspect_project_files', 'summarize_change_plan', 'interpret_check_failure'];
const PROJECT_BUILD_TOOLS = [...PROJECT_READ_TOOLS, 'write_file'];

/**
 * Conservative budgets keep the default plans profitable while still giving
 * a normal app edit enough room to finish and verify.
 */
export const CODEN_SKILLS: readonly CodenSkill[] = [
  {
    id: 'build', version: '1.0.0',
    description: 'Create or modify a project and verify its preview.',
    intents: ['generate', 'build', 'edit', 'create', 'modify', 'ui_edit'],
    capabilities: ['project.read', 'project.write', 'preview.build', 'verification.run'],
    allowedTools: PROJECT_BUILD_TOOLS,
    approvalPolicy: 'automatic', budget: { maxTokens: 90000, maxToolSteps: 10, maxDurationMs: 180000, maxRetries: 3 }, requiresVerification: true,
  },
  {
    id: 'debug', version: '1.0.0',
    description: 'Diagnose a failure, apply the smallest safe fix and retest.',
    intents: ['debug', 'debug_fix', 'fix', 'bug', 'error', 'repair'],
    capabilities: ['project.read', 'project.write', 'preview.build', 'verification.run'],
    allowedTools: PROJECT_BUILD_TOOLS,
    approvalPolicy: 'automatic', budget: { maxTokens: 70000, maxToolSteps: 9, maxDurationMs: 150000, maxRetries: 3 }, requiresVerification: true,
  },
  {
    id: 'review', version: '1.0.0',
    description: 'Review product, UX, UI and maintainability without changing files.',
    intents: ['review', 'audit', 'ux', 'ui', 'quality', 'maintainability'],
    capabilities: ['project.read', 'review.product', 'review.ux'],
    allowedTools: PROJECT_READ_TOOLS,
    approvalPolicy: 'automatic', budget: { maxTokens: 40000, maxToolSteps: 6, maxDurationMs: 90000, maxRetries: 1 }, requiresVerification: false,
  },
  {
    id: 'security', version: '1.0.0',
    description: 'Inspect secrets, permissions, dependencies, migrations and RLS.',
    intents: ['security', 'secure', 'secret', 'permission', 'rls', 'vulnerability'],
    capabilities: ['project.read', 'security.scan'],
    allowedTools: PROJECT_READ_TOOLS,
    approvalPolicy: 'automatic', budget: { maxTokens: 45000, maxToolSteps: 6, maxDurationMs: 100000, maxRetries: 1 }, requiresVerification: true,
  },
  {
    id: 'test', version: '1.0.0',
    description: 'Run checks, lint, build, smoke tests and preview verification.',
    intents: ['test', 'lint', 'typecheck', 'build_check', 'smoke', 'verify'],
    capabilities: ['project.read', 'verification.run'],
    allowedTools: PROJECT_READ_TOOLS,
    approvalPolicy: 'automatic', budget: { maxTokens: 28000, maxToolSteps: 8, maxDurationMs: 120000, maxRetries: 2 }, requiresVerification: true,
  },
  {
    id: 'research', version: '1.0.0',
    description: 'Gather project or documentation context before a decision.',
    intents: ['research', 'documentation', 'context', 'compare', 'investigate'],
    capabilities: ['project.read', 'web.research'],
    allowedTools: ['read_file'],
    approvalPolicy: 'automatic', budget: { maxTokens: 35000, maxToolSteps: 6, maxDurationMs: 90000, maxRetries: 1 }, requiresVerification: false,
  },
  {
    id: 'orchestrate', version: '1.0.0',
    description: 'Coordinate bounded specialist reviews and merge their findings.',
    intents: ['orchestrate', 'decompose', 'multi_agent', 'parallel', 'comprehensive'],
    capabilities: ['project.read', 'subagents.run', 'findings.merge'],
    allowedTools: PROJECT_READ_TOOLS,
    approvalPolicy: 'automatic', budget: { maxTokens: 55000, maxToolSteps: 8, maxDurationMs: 150000, maxRetries: 2 }, requiresVerification: true,
  },
  {
    id: 'release', version: '1.0.0',
    description: 'Prepare a release and verify readiness; publishing still needs confirmation.',
    intents: ['release', 'publish', 'deploy', 'production', 'rollback', 'domain'],
    capabilities: ['project.read', 'preview.build', 'release.prepare'],
    allowedTools: PROJECT_READ_TOOLS,
    approvalPolicy: 'confirmation', budget: { maxTokens: 42000, maxToolSteps: 7, maxDurationMs: 120000, maxRetries: 2 }, requiresVerification: true,
  },
  {
    id: 'automate', version: '1.0.0',
    description: 'Create or run a bounded project workflow with explicit limits.',
    intents: ['automate', 'automation', 'workflow', 'schedule', 'recurring'],
    capabilities: ['project.read', 'workflow.manage', 'verification.run'],
    allowedTools: PROJECT_READ_TOOLS,
    approvalPolicy: 'confirmation', budget: { maxTokens: 35000, maxToolSteps: 6, maxDurationMs: 90000, maxRetries: 1 }, requiresVerification: true,
  },
  {
    id: 'onboarding', version: '1.0.0',
    description: 'Guide a new user toward a useful first project action.',
    intents: ['onboarding', 'welcome', 'first_project', 'getting_started'],
    capabilities: ['project.read'],
    allowedTools: ['read_file'],
    approvalPolicy: 'automatic', budget: { maxTokens: 18000, maxToolSteps: 3, maxDurationMs: 45000, maxRetries: 1 }, requiresVerification: false,
  },
];

const PRIORITY: CodenSkillId[] = ['security', 'release', 'debug', 'test', 'review', 'research', 'orchestrate', 'automate', 'onboarding', 'build'];

export const CRITICAL_ACTION_PATTERN = /\b(publish|deploy|production|rollback|delete|remove|migrat(?:e|ion)|domain|secret|credential|password|push\s+(?:to\s+)?git|billing|payment)\b/i;

export function getCodenSkill(id: string): CodenSkill | null {
  return CODEN_SKILLS.find(skill => skill.id === id) || null;
}

export function listCodenSkills(): CodenSkill[] {
  return CODEN_SKILLS.map(skill => ({ ...skill, intents: [...skill.intents], capabilities: [...skill.capabilities], allowedTools: [...skill.allowedTools], budget: { ...skill.budget } }));
}

export function resolveCodenSkill(input: CodenSkillResolutionInput): CodenSkillResolution {
  const haystack = `${input.intent || ''} ${input.requestedMode || ''} ${input.prompt || ''}`.toLowerCase();
  const critical = CRITICAL_ACTION_PATTERN.test(haystack);
  const candidates = CODEN_SKILLS.map(skill => ({
    skill,
    score: skill.intents.reduce((score, token) => score + (haystack.includes(token.toLowerCase()) ? (input.intent?.toLowerCase().includes(token.toLowerCase()) ? 4 : 2) : 0), 0)
      + (skill.id === 'security' && /\b(security|secure|secret|permission|rls|vulnerability)\b/i.test(haystack) ? 6 : 0)
      + (skill.id === 'debug' && /\b(debug|bug|error|broken|repair|fix)\b/i.test(haystack) ? 5 : 0)
      + (skill.id === 'release' && /\b(publish|deploy|production|rollback|domain)\b/i.test(haystack) ? 5 : 0),
  })).sort((a, b) => b.score - a.score || PRIORITY.indexOf(a.skill.id) - PRIORITY.indexOf(b.skill.id));
  const selected = candidates[0]?.score ? candidates[0].skill : getCodenSkill(input.requestedMode || '') || getCodenSkill('build')!;
  const requiresConfirmation = critical || selected.approvalPolicy === 'confirmation';
  return {
    skill: selected,
    confidence: candidates[0]?.score ? Math.min(0.98, 0.55 + candidates[0].score * 0.08) : 0.52,
    reason: critical ? 'critical_action_requires_confirmation' : `matched_${selected.id}`,
    requiresConfirmation,
    blocked: selected.approvalPolicy === 'blocked',
  };
}

export function canCodenSkillUseTool(skill: CodenSkill, toolName: string): boolean {
  return skill.allowedTools.includes(toolName);
}

export function getCodenSkillBudget(skill: CodenSkill, plan = 'free'): CodenSkillBudget {
  const multiplier = plan === 'scale' || plan === 'enterprise' ? 1.25 : plan === 'pro' ? 1 : 0.75;
  return {
    maxTokens: Math.max(1000, Math.floor(skill.budget.maxTokens * multiplier)),
    maxToolSteps: Math.max(1, Math.floor(skill.budget.maxToolSteps * multiplier)),
    maxDurationMs: Math.max(15000, Math.floor(skill.budget.maxDurationMs * multiplier)),
    maxRetries: skill.budget.maxRetries,
  };
}

export function readCodenSkillFeatureFlags(env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env): CodenSkillFeatureFlags {
  const enabled = (key: string, fallback: boolean) => env[key] === undefined ? fallback : env[key] === '1' || env[key] === 'true';
  return {
    skills: enabled('CODEN_SKILLS_ENABLED', true),
    workflows: enabled('CODEN_WORKFLOWS_ENABLED', true),
    subagents: enabled('CODEN_SUBAGENTS_ENABLED', true),
    scheduledRuns: enabled('CODEN_SCHEDULED_RUNS_ENABLED', false),
  };
}

export function isCriticalCodenAction(prompt: string): boolean {
  return CRITICAL_ACTION_PATTERN.test(prompt);
}

export function capSubagentCount(requested: number, flags = readCodenSkillFeatureFlags()): number {
  return flags.subagents ? Math.min(3, Math.max(0, Math.floor(requested))) : 0;
}
