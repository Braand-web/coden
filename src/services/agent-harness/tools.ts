import type { HarnessAgentRole } from './contracts.ts';

export type HarnessToolRisk = 'read' | 'write' | 'network' | 'critical';

export type HarnessToolDefinition = {
  name: string;
  description: string;
  risk: HarnessToolRisk;
  allowedRoles: HarnessAgentRole[];
  requiresApproval: boolean;
  mutatesWorkspace: boolean;
  resourceScope: 'none' | 'project' | 'files' | 'deployment';
};

const READ_ROLES: HarnessAgentRole[] = [
  'orchestrator', 'explorer', 'planner', 'researcher', 'frontend', 'backend',
  'database', 'integrator', 'tester', 'reviewer', 'security', 'visual_qa',
];

const WRITE_ROLES: HarnessAgentRole[] = ['orchestrator', 'frontend', 'backend', 'database', 'integrator', 'tester'];

export const DEFAULT_HARNESS_TOOLS: HarnessToolDefinition[] = [
  { name: 'workspace.read', description: 'Read project files and metadata.', risk: 'read', allowedRoles: READ_ROLES, requiresApproval: false, mutatesWorkspace: false, resourceScope: 'none' },
  { name: 'workspace.search', description: 'Search symbols and text in the project.', risk: 'read', allowedRoles: READ_ROLES, requiresApproval: false, mutatesWorkspace: false, resourceScope: 'none' },
  { name: 'workspace.patch', description: 'Apply a structured patch to owned files.', risk: 'write', allowedRoles: WRITE_ROLES, requiresApproval: false, mutatesWorkspace: true, resourceScope: 'files' },
  { name: 'shell.exec', description: 'Execute an allow-listed command in the project sandbox.', risk: 'write', allowedRoles: [...WRITE_ROLES, 'reviewer', 'security', 'visual_qa'], requiresApproval: false, mutatesWorkspace: false, resourceScope: 'project' },
  { name: 'browser.inspect', description: 'Inspect the running preview, console and network.', risk: 'read', allowedRoles: ['orchestrator', 'tester', 'reviewer', 'security', 'visual_qa'], requiresApproval: false, mutatesWorkspace: false, resourceScope: 'none' },
  { name: 'web.research', description: 'Read current external documentation.', risk: 'network', allowedRoles: ['orchestrator', 'planner', 'researcher', 'reviewer', 'security'], requiresApproval: false, mutatesWorkspace: false, resourceScope: 'none' },
  { name: 'database.migrate', description: 'Apply a reviewed database migration.', risk: 'critical', allowedRoles: ['orchestrator', 'database', 'integrator'], requiresApproval: true, mutatesWorkspace: true, resourceScope: 'project' },
  { name: 'deployment.publish', description: 'Publish the verified immutable artifact.', risk: 'critical', allowedRoles: ['orchestrator', 'integrator'], requiresApproval: true, mutatesWorkspace: false, resourceScope: 'deployment' },
  { name: 'deployment.rollback', description: 'Rollback a production deployment.', risk: 'critical', allowedRoles: ['orchestrator', 'integrator'], requiresApproval: true, mutatesWorkspace: false, resourceScope: 'deployment' },
];

export class HarnessToolRegistry {
  private readonly definitions = new Map<string, HarnessToolDefinition>();

  constructor(definitions: HarnessToolDefinition[] = DEFAULT_HARNESS_TOOLS) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: HarnessToolDefinition) {
    if (!definition.name.trim()) throw new Error('Harness tool name is required.');
    if (this.definitions.has(definition.name)) throw new Error(`Harness tool already registered: ${definition.name}`);
    this.definitions.set(definition.name, { ...definition, allowedRoles: [...definition.allowedRoles] });
  }

  get(name: string) {
    const definition = this.definitions.get(name);
    if (!definition) throw new Error(`Unknown harness tool: ${name}`);
    return { ...definition, allowedRoles: [...definition.allowedRoles] };
  }

  assertAllowed(name: string, role: HarnessAgentRole, approvalGranted = false) {
    const definition = this.get(name);
    if (!definition.allowedRoles.includes(role)) {
      throw new Error(`Harness role ${role} cannot use ${name}.`);
    }
    if (definition.requiresApproval && !approvalGranted) {
      const error = new Error(`Harness tool ${name} requires explicit approval.`);
      error.name = 'HarnessApprovalRequiredError';
      throw error;
    }
    return definition;
  }

  listForRole(role: HarnessAgentRole) {
    return [...this.definitions.values()].filter(definition => definition.allowedRoles.includes(role));
  }
}
