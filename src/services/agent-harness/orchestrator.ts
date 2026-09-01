import type { DefinitionOfDoneCriterion, HarnessAgentRole } from './contracts.ts';

export type HarnessExecutionNode = {
  id: string;
  title: string;
  role: HarnessAgentRole;
  dependencies: string[];
  resourceKeys: string[];
  optional: boolean;
};

export type HarnessExecutionPlan = {
  objective: string;
  nodes: HarnessExecutionNode[];
  definitionOfDone: DefinitionOfDoneCriterion[];
};

function criterion(id: string, label: string, required = true): DefinitionOfDoneCriterion {
  return { id, label, required, status: 'pending' };
}

export function buildDefinitionOfDone(input: {
  prompt: string;
  mode: string;
  hasBackend?: boolean;
  hasDatabase?: boolean;
  requiresDeployment?: boolean;
}) {
  if (['ask', 'plan', 'research', 'review'].includes(input.mode)) {
    return [criterion('answer_complete', 'The response directly answers the user request with supported conclusions.')];
  }
  const checks = [
    criterion('requested_behavior', 'The requested user-visible behavior is implemented.'),
    criterion('build', 'The project builds successfully.'),
    criterion('preview', 'The preview starts and renders meaningful content.'),
    criterion('browser_smoke', 'The primary browser journey completes without a blocking error.'),
    criterion('console', 'The primary journey has no blocking console exception.'),
    criterion('responsive', 'The primary interface remains usable on desktop and mobile.'),
  ];
  if (input.hasBackend) checks.push(criterion('backend_health', 'The backend healthcheck and critical API route pass.'));
  if (input.hasDatabase) checks.push(criterion('database', 'Database migrations and access policies are valid.'));
  if (input.requiresDeployment) checks.push(criterion('production', 'The deployed artifact passes its production healthcheck.'));
  return checks;
}

export function buildExecutionPlan(input: {
  prompt: string;
  mode: string;
  hasExistingFiles: boolean;
  hasBackend?: boolean;
  hasDatabase?: boolean;
  requiresResearch?: boolean;
  requiresDeployment?: boolean;
}): HarnessExecutionPlan {
  const readOnly = ['ask', 'plan', 'research', 'review'].includes(input.mode);
  const nodes: HarnessExecutionNode[] = [
    { id: 'inspect', title: 'Inspect the relevant project context', role: 'explorer', dependencies: [], resourceKeys: [], optional: !input.hasExistingFiles },
  ];
  if (input.requiresResearch || input.mode === 'research') {
    nodes.push({ id: 'research', title: 'Research current authoritative documentation', role: 'researcher', dependencies: [], resourceKeys: [], optional: false });
  }
  nodes.push({ id: 'plan', title: 'Resolve the smallest verifiable execution plan', role: 'planner', dependencies: nodes.map(node => node.id), resourceKeys: [], optional: input.mode === 'ask' });
  if (!readOnly) {
    nodes.push({ id: 'frontend', title: 'Implement the user-facing application', role: 'frontend', dependencies: ['plan'], resourceKeys: ['src/frontend'], optional: false });
    if (input.hasBackend) nodes.push({ id: 'backend', title: 'Implement and validate backend services', role: 'backend', dependencies: ['plan'], resourceKeys: ['src/backend'], optional: false });
    if (input.hasDatabase) nodes.push({ id: 'database', title: 'Implement schema, migrations and policies', role: 'database', dependencies: ['plan'], resourceKeys: ['supabase'], optional: false });
    const writers = nodes.filter(node => ['frontend', 'backend', 'database'].includes(node.id)).map(node => node.id);
    nodes.push({ id: 'integrate', title: 'Integrate worker patches into the canonical snapshot', role: 'integrator', dependencies: writers, resourceKeys: ['project'], optional: false });
    nodes.push({ id: 'test', title: 'Build and exercise the critical journeys', role: 'tester', dependencies: ['integrate'], resourceKeys: [], optional: false });
    nodes.push({ id: 'visual', title: 'Inspect the rendered preview and responsive states', role: 'visual_qa', dependencies: ['test'], resourceKeys: [], optional: false });
    nodes.push({ id: 'review', title: 'Independently review evidence and diff', role: 'reviewer', dependencies: ['test', 'visual'], resourceKeys: [], optional: false });
  }
  return {
    objective: input.prompt.trim(),
    nodes,
    definitionOfDone: buildDefinitionOfDone(input),
  };
}

export function runnableExecutionNodes(plan: HarnessExecutionPlan, completed: Set<string>, active: Set<string>) {
  return plan.nodes.filter(node => !completed.has(node.id) && !active.has(node.id) && node.dependencies.every(dependency => completed.has(dependency)));
}

export function assertNoWriterResourceConflict(nodes: HarnessExecutionNode[]) {
  const owners = new Map<string, string>();
  for (const node of nodes) {
    if (!['frontend', 'backend', 'database', 'integrator', 'tester'].includes(node.role)) continue;
    for (const key of node.resourceKeys) {
      const owner = owners.get(key);
      if (owner) throw new Error(`Harness writer resource conflict: ${owner} and ${node.id} both own ${key}.`);
      owners.set(key, node.id);
    }
  }
}
