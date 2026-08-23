/**
 * Comprehensive tests for the RBAC engine.
 *
 * Run with:  node --experimental-strip-types test-rbac-engine.ts
 */

import {
  RBACEngine,
  InMemoryRBACStore,
  resolvePermissions,
  DEFAULT_ROLES,
  type RoleName,
} from './src/services/rbac-engine.ts';

import { strict as assert } from 'node:assert';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG = { type: 'org' as const, orgId: 'org-1' };
const PROJECT_A = { type: 'project' as const, projectId: 'proj-a' };
const PROJECT_B = { type: 'project' as const, projectId: 'proj-b' };

function freshEngine() {
  return new RBACEngine(new InMemoryRBACStore());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testRoleHierarchyOrder() {
  // viewer < editor < admin < owner (by inspecting resolved permission counts)
  const viewerPerms = resolvePermissions('viewer');
  const editorPerms = resolvePermissions('editor');
  const adminPerms = resolvePermissions('admin');
  const ownerPerms = resolvePermissions('owner');

  assert.ok(viewerPerms.size < editorPerms.size, 'editor has more perms than viewer');
  assert.ok(editorPerms.size < adminPerms.size, 'admin has more perms than editor');
  assert.ok(adminPerms.size < ownerPerms.size, 'owner has more perms than admin');
  console.log('  [pass] role hierarchy order');
}

async function testPermissionInheritance() {
  const editorPerms = resolvePermissions('editor');

  // Editor should have all viewer permissions
  for (const p of resolvePermissions('viewer')) {
    assert.ok(editorPerms.has(p), `editor inherits viewer permission '${p}'`);
  }

  // Admin should have all editor (and hence viewer) permissions
  const adminPerms = resolvePermissions('admin');
  for (const p of editorPerms) {
    assert.ok(adminPerms.has(p), `admin inherits editor permission '${p}'`);
  }

  // Owner should have all admin permissions
  const ownerPerms = resolvePermissions('owner');
  for (const p of adminPerms) {
    assert.ok(ownerPerms.has(p), `owner inherits admin permission '${p}'`);
  }

  console.log('  [pass] permission inheritance');
}

async function testProjectLevelRoleAssignmentAndChecking() {
  const engine = freshEngine();
  await engine.assignRole('user-1', 'editor', PROJECT_A, 'system');

  // Should have editor permissions on project A
  assert.ok(await engine.can('user-1', 'project:edit', 'proj-a'));
  assert.ok(await engine.can('user-1', 'generation:run', 'proj-a'));
  // Inherited viewer perms
  assert.ok(await engine.can('user-1', 'project:read', 'proj-a'));
  // Should NOT have admin-level perms
  assert.ok(!(await engine.can('user-1', 'project:delete', 'proj-a')));
  // Should NOT have perms on a different project
  assert.ok(!(await engine.can('user-1', 'project:edit', 'proj-b')));

  console.log('  [pass] project-level role assignment + checking');
}

async function testOrgLevelRoleAsFloor() {
  const engine = freshEngine();
  await engine.assignRole('user-2', 'viewer', ORG, 'system');

  // Viewer perms should apply to any project (org is a floor)
  assert.ok(await engine.can('user-2', 'project:read', 'proj-a'));
  assert.ok(await engine.can('user-2', 'project:read', 'proj-b'));
  assert.ok(await engine.can('user-2', 'generation:view', 'proj-a'));

  // But not higher perms
  assert.ok(!(await engine.can('user-2', 'project:edit', 'proj-a')));

  console.log('  [pass] org-level role as floor');
}

async function testBillingRole() {
  const engine = freshEngine();
  await engine.assignRole('billing-user', 'billing', ORG, 'system');

  // Billing-specific perms
  assert.ok(await engine.can('billing-user', 'billing:manage', 'proj-a'));
  assert.ok(await engine.can('billing-user', 'billing:view', 'proj-a'));
  assert.ok(await engine.can('billing-user', 'project:read', 'proj-a'));

  // No edit access
  assert.ok(!(await engine.can('billing-user', 'project:edit', 'proj-a')));
  assert.ok(!(await engine.can('billing-user', 'generation:run', 'proj-a')));

  console.log('  [pass] billing role (non-hierarchical)');
}

async function testRequirePermissionThrows() {
  const engine = freshEngine();
  await engine.assignRole('user-3', 'viewer', ORG, 'system');

  // Should not throw for an allowed permission
  await engine.requirePermission('user-3', 'project:read');

  // Should throw for a denied permission
  let threw = false;
  try {
    await engine.requirePermission('user-3', 'project:delete', 'proj-a');
  } catch (err: any) {
    threw = true;
    assert.ok(err.message.includes('Access denied'));
    assert.ok(err.message.includes('project:delete'));
  }
  assert.ok(threw, 'requirePermission should throw on denial');

  console.log('  [pass] requirePermission throws on denial');
}

async function testRevokeRole() {
  const engine = freshEngine();
  await engine.assignRole('user-4', 'admin', PROJECT_A, 'system');

  assert.ok(await engine.can('user-4', 'project:delete', 'proj-a'));

  await engine.revokeRole('user-4', PROJECT_A);

  assert.ok(!(await engine.can('user-4', 'project:delete', 'proj-a')));
  assert.ok(!(await engine.can('user-4', 'project:read', 'proj-a')));

  console.log('  [pass] revoke role');
}

async function testGetEffectivePermissions() {
  const engine = freshEngine();
  await engine.assignRole('user-5', 'editor', PROJECT_A, 'system');

  const perms = await engine.getEffectivePermissions('user-5', 'proj-a');

  // Should contain all editor + viewer permissions
  const expected = resolvePermissions('editor');
  assert.deepStrictEqual(perms, expected);

  console.log('  [pass] getEffectivePermissions returns full set');
}

async function testGetProjectMembers() {
  const engine = freshEngine();
  await engine.assignRole('alice', 'owner', PROJECT_A, 'system');
  await engine.assignRole('bob', 'editor', PROJECT_A, 'system');
  await engine.assignRole('carol', 'viewer', PROJECT_A, 'system');
  // Dave is on a different project — should NOT appear
  await engine.assignRole('dave', 'admin', PROJECT_B, 'system');

  const members = await engine.getProjectMembers('proj-a');
  const userIds = members.map(m => m.userId).sort();
  assert.deepStrictEqual(userIds, ['alice', 'bob', 'carol']);

  console.log('  [pass] getProjectMembers');
}

async function testGetUserRolesAcrossScopes() {
  const engine = freshEngine();
  await engine.assignRole('multi', 'viewer', ORG, 'system');
  await engine.assignRole('multi', 'admin', PROJECT_A, 'system');
  await engine.assignRole('multi', 'editor', PROJECT_B, 'system');

  const roles = await engine.getUserRoles('multi');
  assert.strictEqual(roles.length, 3);

  const scopes = roles.map(r =>
    r.scope.type === 'org' ? `org:${r.scope.orgId}` : `project:${r.scope.projectId}`,
  ).sort();
  assert.deepStrictEqual(scopes, ['org:org-1', 'project:proj-a', 'project:proj-b']);

  console.log('  [pass] getUserRoles across scopes');
}

async function testEdgeNoRoleNoPermissions() {
  const engine = freshEngine();

  // User with no bindings at all
  assert.ok(!(await engine.can('ghost', 'project:read')));
  assert.ok(!(await engine.can('ghost', 'project:read', 'proj-a')));

  const perms = await engine.getEffectivePermissions('ghost', 'proj-a');
  assert.strictEqual(perms.size, 0);

  console.log('  [pass] edge: no role -> no permissions');
}

async function testProjectRoleOverridesOrgWhenHigher() {
  const engine = freshEngine();

  // Org-level viewer, project-level admin
  await engine.assignRole('user-6', 'viewer', ORG, 'system');
  await engine.assignRole('user-6', 'admin', PROJECT_A, 'system');

  // On project A, should have admin permissions (union of org viewer + project admin)
  assert.ok(await engine.can('user-6', 'project:delete', 'proj-a'));
  assert.ok(await engine.can('user-6', 'members:manage', 'proj-a'));

  // On project B (no project binding), only org viewer applies
  assert.ok(await engine.can('user-6', 'project:read', 'proj-b'));
  assert.ok(!(await engine.can('user-6', 'project:delete', 'proj-b')));

  console.log('  [pass] edge: project role overrides org role when higher');
}

async function testResolvePermissionsHelper() {
  // Direct test of the exported helper
  const viewerPerms = resolvePermissions('viewer');
  assert.ok(viewerPerms.has('project:read'));
  assert.ok(viewerPerms.has('generation:view'));
  assert.strictEqual(viewerPerms.size, 2);

  const billingPerms = resolvePermissions('billing');
  assert.ok(billingPerms.has('billing:manage'));
  assert.ok(billingPerms.has('billing:view'));
  assert.ok(billingPerms.has('project:read'));
  assert.strictEqual(billingPerms.size, 3);

  console.log('  [pass] resolvePermissions helper');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  console.log('Running RBAC engine tests...\n');

  await testRoleHierarchyOrder();
  await testPermissionInheritance();
  await testProjectLevelRoleAssignmentAndChecking();
  await testOrgLevelRoleAsFloor();
  await testBillingRole();
  await testRequirePermissionThrows();
  await testRevokeRole();
  await testGetEffectivePermissions();
  await testGetProjectMembers();
  await testGetUserRolesAcrossScopes();
  await testEdgeNoRoleNoPermissions();
  await testProjectRoleOverridesOrgWhenHigher();
  await testResolvePermissionsHelper();

  console.log('\ntest-rbac-engine passed');
}

main().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
