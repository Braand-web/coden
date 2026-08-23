/**
 * Role-Based Access Control engine for the Coden SaaS platform.
 *
 * Replaces the simple ADMIN_EMAILS array with a proper RBAC system featuring:
 * - Granular string-based permissions (e.g. `project:create`, `generation:run`)
 * - Named roles that bundle permissions: owner, admin, editor, viewer, billing
 * - Role hierarchy with permission inheritance (owner > admin > editor > viewer)
 * - Project-level AND organization-level role assignments
 * - Org role acts as a permission floor; project roles can only elevate access
 * - Interface-based storage with in-memory implementation for dev/testing
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A granular permission string, e.g. `project:create` or `generation:run`. */
export type Permission = string;

/** The set of named roles recognized by the RBAC engine. */
export type RoleName = 'owner' | 'admin' | 'editor' | 'viewer' | 'billing';

/** Where a role binding applies — either org-wide or to a single project. */
export type RoleScope =
  | { type: 'org'; orgId: string }
  | { type: 'project'; projectId: string };

/** Static definition of a role: its direct permissions and optional parent. */
export type RoleDefinition = {
  name: RoleName;
  permissions: Permission[];
  /** If set, this role inherits all permissions of the named role (and its ancestors). */
  inherits?: RoleName;
};

/** A concrete binding of a user to a role within a scope. */
export type RoleBinding = {
  userId: string;
  role: RoleName;
  scope: RoleScope;
  grantedBy: string;
  grantedAt: string; // ISO-8601
};

// ---------------------------------------------------------------------------
// Default role definitions
// ---------------------------------------------------------------------------

export const DEFAULT_ROLES: Map<RoleName, RoleDefinition> = new Map([
  [
    'viewer',
    {
      name: 'viewer',
      permissions: ['project:read', 'generation:view'],
    },
  ],
  [
    'editor',
    {
      name: 'editor',
      permissions: [
        'project:edit',
        'generation:run',
        'generation:view_history',
        'files:read',
        'files:write',
      ],
      inherits: 'viewer',
    },
  ],
  [
    'admin',
    {
      name: 'admin',
      permissions: [
        'project:create',
        'project:delete',
        'project:settings',
        'members:manage',
        'generation:configure',
      ],
      inherits: 'editor',
    },
  ],
  [
    'owner',
    {
      name: 'owner',
      permissions: [
        'billing:manage',
        'org:settings',
        'org:delete',
        'admin:users',
        'admin:audit',
      ],
      inherits: 'admin',
    },
  ],
  [
    'billing',
    {
      name: 'billing',
      permissions: ['billing:manage', 'billing:view', 'project:read'],
      // No `inherits` — billing is a non-hierarchical role.
    },
  ],
]);

// ---------------------------------------------------------------------------
// Role hierarchy helpers
// ---------------------------------------------------------------------------

/**
 * Walk the inheritance chain for `roleName` and return the full, deduplicated
 * set of permissions the role grants.
 */
export function resolvePermissions(
  roleName: RoleName,
  roles: Map<RoleName, RoleDefinition> = DEFAULT_ROLES,
): Set<Permission> {
  const permissions = new Set<Permission>();
  const visited = new Set<RoleName>();
  let current: RoleName | undefined = roleName;

  while (current && !visited.has(current)) {
    visited.add(current);
    const def = roles.get(current);
    if (!def) break;
    for (const p of def.permissions) {
      permissions.add(p);
    }
    current = def.inherits;
  }

  return permissions;
}

/**
 * Numeric rank for the hierarchical roles. Higher = more powerful.
 * `billing` is outside the hierarchy and gets rank 0.
 */
const HIERARCHY_RANK: Record<RoleName, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
  billing: 0,
};

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

/** Persistence abstraction so the engine can be backed by any datastore. */
export interface RBACStore {
  /** Persist a role binding (upsert by userId + scope). */
  setBinding(binding: RoleBinding): Promise<void> | void;

  /** Remove the binding for a user in a given scope. */
  removeBinding(userId: string, scope: RoleScope): Promise<void> | void;

  /** Return all bindings for a user. */
  getBindingsForUser(userId: string): Promise<RoleBinding[]> | RoleBinding[];

  /** Return all bindings within a project scope. */
  getBindingsForProject(projectId: string): Promise<RoleBinding[]> | RoleBinding[];
}

// ---------------------------------------------------------------------------
// In-memory store (dev / testing)
// ---------------------------------------------------------------------------

function scopeKey(scope: RoleScope): string {
  return scope.type === 'org' ? `org:${scope.orgId}` : `project:${scope.projectId}`;
}

function bindingKey(userId: string, scope: RoleScope): string {
  return `${userId}::${scopeKey(scope)}`;
}

export class InMemoryRBACStore implements RBACStore {
  private bindings = new Map<string, RoleBinding>();

  setBinding(binding: RoleBinding): void {
    this.bindings.set(bindingKey(binding.userId, binding.scope), binding);
  }

  removeBinding(userId: string, scope: RoleScope): void {
    this.bindings.delete(bindingKey(userId, scope));
  }

  getBindingsForUser(userId: string): RoleBinding[] {
    const result: RoleBinding[] = [];
    for (const b of this.bindings.values()) {
      if (b.userId === userId) result.push(b);
    }
    return result;
  }

  getBindingsForProject(projectId: string): RoleBinding[] {
    const result: RoleBinding[] = [];
    for (const b of this.bindings.values()) {
      if (b.scope.type === 'project' && b.scope.projectId === projectId) {
        result.push(b);
      }
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// RBAC Engine
// ---------------------------------------------------------------------------

export class RBACEngine {
  private store: RBACStore;
  private roles: Map<RoleName, RoleDefinition>;

  constructor(store: RBACStore, roles?: Map<RoleName, RoleDefinition>) {
    this.store = store;
    this.roles = roles ?? DEFAULT_ROLES;
  }

  // ---- Role assignment / revocation ----------------------------------

  /** Assign a role to a user within a scope (org or project). Upserts. */
  async assignRole(
    userId: string,
    role: RoleName,
    scope: RoleScope,
    grantedBy: string,
  ): Promise<RoleBinding> {
    const binding: RoleBinding = {
      userId,
      role,
      scope,
      grantedBy,
      grantedAt: new Date().toISOString(),
    };
    await this.store.setBinding(binding);
    return binding;
  }

  /** Remove a user's role binding in a given scope. */
  async revokeRole(userId: string, scope: RoleScope): Promise<void> {
    await this.store.removeBinding(userId, scope);
  }

  // ---- Queries -------------------------------------------------------

  /** Get all role bindings for a user across every scope. */
  async getUserRoles(userId: string): Promise<RoleBinding[]> {
    return this.store.getBindingsForUser(userId);
  }

  /** Get all users (bindings) that have a role on a specific project. */
  async getProjectMembers(projectId: string): Promise<RoleBinding[]> {
    return this.store.getBindingsForProject(projectId);
  }

  // ---- Permission resolution -----------------------------------------

  /**
   * Compute the effective set of permissions for a user.
   *
   * When `projectId` is supplied the engine considers:
   * 1. The user's org-level role (as a permission floor).
   * 2. The user's project-level role.
   * The returned set is the **union** of permissions from both scopes.
   *
   * When `projectId` is omitted only org-level roles are considered.
   */
  async getEffectivePermissions(
    userId: string,
    projectId?: string,
  ): Promise<Set<Permission>> {
    const bindings = await this.store.getBindingsForUser(userId);

    const permissions = new Set<Permission>();

    for (const b of bindings) {
      const isOrgBinding = b.scope.type === 'org';
      const isMatchingProject =
        b.scope.type === 'project' && b.scope.projectId === projectId;

      if (isOrgBinding || isMatchingProject) {
        for (const p of resolvePermissions(b.role, this.roles)) {
          permissions.add(p);
        }
      }
    }

    return permissions;
  }

  // ---- Authorization -------------------------------------------------

  /**
   * Check whether a user holds a specific permission.
   * If `projectId` is provided, both org and project bindings are evaluated.
   */
  async can(
    userId: string,
    permission: Permission,
    projectId?: string,
  ): Promise<boolean> {
    const perms = await this.getEffectivePermissions(userId, projectId);
    return perms.has(permission);
  }

  /**
   * Like `can` but throws an error when the permission is not held.
   * Useful as middleware-style guard.
   */
  async requirePermission(
    userId: string,
    permission: Permission,
    projectId?: string,
  ): Promise<void> {
    const allowed = await this.can(userId, permission, projectId);
    if (!allowed) {
      const ctx = projectId ? ` on project ${projectId}` : '';
      throw new Error(
        `Access denied: user ${userId} lacks permission '${permission}'${ctx}`,
      );
    }
  }
}
