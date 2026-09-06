import { CODEN_SKILL_PROVENANCE, type CodenSkillSource } from './coden-skill-provenance.ts';

/**
 * Capability-level skill planning for Coden.
 *
 * The model router already provides intent and complexity. This module applies
 * deterministic compatibility and cost rules to that judgement, so a model
 * cannot load the entire catalogue or invent a parallel workflow. Only the
 * selected skill ids are compiled into the generation prompt.
 */

export type CodenCapabilitySkillId =
  | 'requirements-discovery'
  | 'specification-and-dod'
  | 'planning-and-execution'
  | 'context-and-repo-intelligence'
  | 'architecture-and-domain'
  | 'multi-agent-orchestration'
  | 'incremental-implementation'
  | 'tdd-implementation'
  | 'systematic-debugging'
  | 'integration-setup'
  | 'database-and-migrations'
  | 'frontend-design'
  | 'ux-accessibility-review'
  | 'browser-and-visual-qa'
  | 'security-performance-observability'
  | 'git-checkpoint-and-conflicts'
  | 'deployment-and-rollback'
  | 'independent-verification';

export type CodenSkillPhase = 'understand' | 'inspect' | 'architect' | 'implement' | 'verify' | 'release';
export type CodenSkillAgentRole = 'master' | 'explorer' | 'product' | 'architect' | 'frontend' | 'backend' | 'database' | 'test' | 'browser' | 'reviewer' | 'release';

export type CodenCapabilitySkill = {
  id: CodenCapabilitySkillId;
  version: '1.0.0';
  phase: CodenSkillPhase;
  role: CodenSkillAgentRole;
  readOnly: boolean;
  description: string;
  instruction: string;
  completionCriteria: readonly string[];
  evidenceRequired: readonly string[];
  provenance: readonly CodenSkillSource[];
};

export type CodenSkillPlanInput = {
  prompt: string;
  intent?: string;
  complexity?: 'simple' | 'medium' | 'complex' | 'extreme';
  fileCount?: number;
  risk?: 'low' | 'medium' | 'high' | 'critical';
};

export type CodenSkillPlanNode = {
  id: string;
  phase: CodenSkillPhase;
  skillIds: CodenCapabilitySkillId[];
  roles: CodenSkillAgentRole[];
  dependsOn: string[];
  parallel: boolean;
};

export type CodenSkillExecutionPlan = {
  version: 1;
  selectionBasis: 'deterministic-preflight+model-intent';
  selectedSkillIds: CodenCapabilitySkillId[];
  nodes: CodenSkillPlanNode[];
  maxSkillsPerNode: 3;
  maxParallelWriters: 3;
  requiresFunctionalGate: boolean;
  requiresDesignGate: boolean;
};

const skill = (
  id: CodenCapabilitySkillId,
  phase: CodenSkillPhase,
  role: CodenSkillAgentRole,
  readOnly: boolean,
  description: string,
  instruction: string,
  completionCriteria: readonly string[],
  evidenceRequired: readonly string[],
): CodenCapabilitySkill => ({ id, version: '1.0.0', phase, role, readOnly, description, instruction, completionCriteria, evidenceRequired, provenance: CODEN_SKILL_PROVENANCE[id] });

export const CODEN_CAPABILITY_SKILLS: readonly CodenCapabilitySkill[] = [
  skill('requirements-discovery', 'understand', 'product', true, 'Resolve only material ambiguity after inspecting available facts.', 'Inspect available facts first, map only consequential decisions, and ask at most one indispensable user question.', ['No material ambiguity remains or one precise decision is requested.'], ['Resolved facts', 'Outstanding decision when present']),
  skill('specification-and-dod', 'understand', 'product', true, 'Turn the request into observable acceptance criteria.', 'Translate the request into user outcomes, explicit scope and verifiable completion criteria without inventing requirements.', ['Definition of Done covers the requested user journeys and failure states.'], ['Definition of Done', 'Out-of-scope list']),
  skill('planning-and-execution', 'understand', 'master', true, 'Build and revise the smallest executable plan.', 'Create small dependency-aware tasks, preserve working states between them, and revise the plan from observed results.', ['Every task has an owner, dependency and verification command.'], ['Executable DAG', 'Verification mapping']),
  skill('context-and-repo-intelligence', 'inspect', 'explorer', true, 'Retrieve only relevant symbols, files, routes and project decisions.', 'Load project rules, relevant files, tests and one existing pattern; summarize stale output instead of flooding context.', ['The writer context contains the real interfaces and conventions needed for its task.'], ['Relevant file map', 'Applicable conventions']),
  skill('architecture-and-domain', 'architect', 'architect', true, 'Define domain boundaries, interfaces and reversible architecture.', 'Prefer deep modules with small interfaces, name domain concepts precisely, and add seams only when variation is real.', ['Interfaces, ownership and integration seams are explicit.'], ['Architecture decision summary', 'Pinned interfaces']),
  skill('multi-agent-orchestration', 'architect', 'master', true, 'Delegate independent work with isolated context and resource ownership.', 'Parallelize only independent work, reserve resources per writer, pin shared interfaces first, and integrate through one canonical owner.', ['No concurrent writer owns the same resource and every result is reviewed before integration.'], ['Resource locks', 'Worker dispositions']),
  skill('incremental-implementation', 'implement', 'frontend', false, 'Implement previewable vertical slices instead of a big-bang rewrite.', 'Deliver the smallest end-to-end slice, verify it, then continue; avoid unrelated cleanup and speculative abstractions.', ['The requested behavior works while the project remains buildable.'], ['Patch', 'Targeted check result']),
  skill('tdd-implementation', 'implement', 'test', false, 'Use red and green cycles where behavior is testable.', 'Test behavior through a public seam: observe a relevant failure, apply the minimal patch, then observe the test pass.', ['A behavior-focused regression test passes at the agreed seam.'], ['Red result', 'Green result']),
  skill('systematic-debugging', 'inspect', 'backend', false, 'Reproduce, localize and repair the root cause with a regression check.', 'Build a tight reproduction, rank falsifiable hypotheses, change one variable at a time, fix the root cause and rerun the original repro.', ['The original symptom no longer reproduces and debug instrumentation is removed.'], ['Reproduction', 'Root cause', 'Regression result']),
  skill('integration-setup', 'architect', 'backend', false, 'Configure APIs, OAuth, webhooks and required environment safely.', 'Discover configuration from the project, request only unavailable secrets, validate each value without exposing it, and resume from the paused checkpoint.', ['Every required integration reports connected or an explicit recoverable blocker.'], ['Redacted configuration check', 'Integration health result']),
  skill('database-and-migrations', 'implement', 'database', false, 'Apply additive schema, RLS and migration changes with rollback evidence.', 'Use additive migrations, least-privilege RLS, isolated preview data and a reversible migration path; never fabricate persistence.', ['Schema applies cleanly and authorized plus unauthorized data paths are verified.'], ['Migration result', 'RLS checks', 'Rollback plan']),
  skill('frontend-design', 'implement', 'frontend', false, 'Create a distinctive, coherent interface aligned with the product.', 'Choose a clear visual direction, preserve product coherence, implement responsive states and avoid generic decorative excess.', ['The main journey is usable at desktop and mobile widths with complete loading, empty, error and success states.'], ['Desktop screenshot', 'Mobile screenshot']),
  skill('ux-accessibility-review', 'verify', 'reviewer', true, 'Review flows, states, responsive behavior, keyboard and WCAG concerns.', 'Audit hierarchy, interaction feedback, keyboard focus, semantics, contrast, responsive layout and recovery paths.', ['No blocking UX or accessibility finding remains.'], ['Findings with element evidence', 'Keyboard journey']),
  skill('browser-and-visual-qa', 'verify', 'browser', true, 'Exercise the real preview and inspect DOM, console, network and screenshots.', 'Open the running preview, execute critical journeys, inspect console and network, and compare desktop plus mobile screenshots after repairs.', ['Healthcheck and critical browser journeys pass without blocking console or network errors.'], ['Preview URL', 'Journey results', 'Screenshots']),
  skill('security-performance-observability', 'verify', 'reviewer', true, 'Check security, dependencies, performance and runtime evidence.', 'Prioritize exploitable security boundaries, measure performance before optimizing, and require structured redacted telemetry for failures.', ['No blocking security finding remains and measured regressions are addressed or documented.'], ['Security findings', 'Performance measurement', 'Trace identifier']),
  skill('git-checkpoint-and-conflicts', 'inspect', 'master', false, 'Protect a working revision and integrate changes by intent.', 'Checkpoint before risky changes, resolve conflicts from both changes’ intent, and verify the integrated result without discarding user work.', ['A known-good revision and clean integration diff are available.'], ['Checkpoint revision', 'Integrated diff']),
  skill('deployment-and-rollback', 'release', 'release', false, 'Promote the verified artifact and retain a tested rollback path.', 'Publish only the immutable verified artifact after approval, run production health and critical-path checks, and retain the prior healthy deployment.', ['Production checks pass or rollback restores the previous healthy version.'], ['Artifact hash', 'Deployment id', 'Production health result']),
  skill('independent-verification', 'verify', 'reviewer', true, 'Return PASS, REPAIR or BLOCKED from evidence independent of the writer.', 'Review mission compliance separately from quality and security; accept only fresh command, browser and artifact evidence.', ['Verdict is PASS, REPAIR or BLOCKED with concrete evidence.'], ['Independent verdict', 'Finding dispositions']),
] as const;

const byId = new Map(CODEN_CAPABILITY_SKILLS.map(skill => [skill.id, skill]));
const WRITE_INTENTS = /^(build|generate|edit|ui_edit|debug_fix|fix|repair)$/;

function has(text: string, pattern: RegExp) { return pattern.test(text); }

export function resolveCodenSkillPlan(input: CodenSkillPlanInput): CodenSkillExecutionPlan {
  const text = `${input.intent || ''} ${input.prompt || ''}`.toLowerCase();
  const complexity = input.complexity || 'medium';
  const writing = WRITE_INTENTS.test(String(input.intent || '')) || has(text, /\b(create|build|modify|change|add|fix|repair|cr[eé]e|construis|modifie|ajoute|corrige|r[eé]pare)\b/i);
  const debugging = has(text, /\b(debug|bug|error|broken|crash|fail|corrige|r[eé]pare|plante)\b/i);
  const design = has(text, /\b(ui|ux|design|interface|responsive|mobile|visual|couleur|color|bleu|vert|rouge|blue|green|red|typograph|layout|header|dashboard)\b/i);
  const database = has(text, /\b(database|supabase|postgres|sql|schema|migration|rls|crud|base de donn[eé]es)\b/i);
  const integration = has(text, /\b(api|oauth|webhook|stripe|payment|paiement|upload|storage|integration|auth)\b/i);
  const release = has(text, /\b(deploy|publish|production|rollback|domain|d[eé]ploie|publie)\b/i);
  const security = input.risk === 'high' || input.risk === 'critical' || has(text, /\b(security|secure|secret|permission|auth|payment|rls|s[eé]curit[eé])\b/i);
  const complex = complexity === 'complex' || complexity === 'extreme' || database || integration || (input.fileCount || 0) > 20;

  const minimalVisualEdit = writing && complexity === 'simple' && design && !debugging && !database && !integration && !release;

  const selected = new Set<CodenCapabilitySkillId>();
  if (minimalVisualEdit) selected.add('incremental-implementation');
  if (debugging) selected.add('systematic-debugging');
  if (writing && !debugging && !minimalVisualEdit) selected.add('incremental-implementation');
  if (writing && complexity !== 'simple') selected.add('specification-and-dod');
  if ((input.fileCount || 0) > 0 && !minimalVisualEdit) selected.add('context-and-repo-intelligence');
  if (complex) selected.add('architecture-and-domain');
  if (complex && writing) selected.add('planning-and-execution');
  if (complex && writing) selected.add('multi-agent-orchestration');
  if (writing && complexity !== 'simple') selected.add('tdd-implementation');
  if (database) selected.add('database-and-migrations');
  if (integration) selected.add('integration-setup');
  if (design && !minimalVisualEdit) selected.add('frontend-design');
  if (design && !minimalVisualEdit) selected.add('ux-accessibility-review');
  if ((writing || debugging || design) && !minimalVisualEdit) selected.add('browser-and-visual-qa');
  if (security) selected.add('security-performance-observability');
  if (writing && !minimalVisualEdit && ((input.fileCount || 0) > 0 || complex)) selected.add('git-checkpoint-and-conflicts');
  if (release) selected.add('deployment-and-rollback');
  if ((writing || debugging || release) && !minimalVisualEdit) selected.add('independent-verification');
  if (!selected.size) selected.add('requirements-discovery');

  const phases: CodenSkillPhase[] = ['understand', 'inspect', 'architect', 'implement', 'verify', 'release'];
  const nodes: CodenSkillPlanNode[] = [];
  let previousPhaseNodes: string[] = [];
  for (const phase of phases) {
    const phaseSkills = [...selected].map(id => byId.get(id)!).filter(skill => skill.phase === phase);
    const phaseNodes: string[] = [];
    for (let offset = 0; offset < phaseSkills.length; offset += 3) {
      const chunk = phaseSkills.slice(offset, offset + 3);
      const id = `${phase}-${Math.floor(offset / 3) + 1}`;
      nodes.push({
        id,
        phase,
        skillIds: chunk.map(skill => skill.id),
        roles: [...new Set(chunk.map(skill => skill.role))],
        dependsOn: [...previousPhaseNodes],
        parallel: (previousPhaseNodes.length > 0 || chunk.length > 1)
          && chunk.every(skill => skill.readOnly || phase === 'implement'),
      });
      phaseNodes.push(id);
    }
    if (phaseNodes.length) previousPhaseNodes = phaseNodes;
  }

  return {
    version: 1,
    selectionBasis: 'deterministic-preflight+model-intent',
    selectedSkillIds: [...selected],
    nodes,
    maxSkillsPerNode: 3,
    maxParallelWriters: 3,
    requiresFunctionalGate: writing || debugging || release,
    requiresDesignGate: design,
  };
}

/** Compact compiler output: selected policies only, never the full catalogue. */
export function renderCodenSkillPlan(plan: CodenSkillExecutionPlan): string {
  return plan.nodes.map(node => {
    const policies = node.skillIds.map(id => {
      const selected = byId.get(id)!;
      return `- ${id}: ${selected.instruction} Completion: ${selected.completionCriteria.join(' ')}`;
    });
    return `${node.phase}:\n${policies.join('\n')}`;
  }).join('\n');
}
