import assert from 'node:assert/strict';
import {
  canReassignProjectSlug,
  deriveProjectName,
  isAutomaticallyDerivedProjectName,
  sanitizeSuggestedProjectName,
} from './src/services/project-naming.ts';

assert.equal(deriveProjectName('cree une mini calculatrice'), 'QuickCalc');
assert.equal(deriveProjectName('Create a modern todo app'), 'TaskFlow');
assert.equal(deriveProjectName('Build a game for learning chemistry'), 'PlayLab');
assert.equal(deriveProjectName('Create a veterinary appointment portal'), 'Veterinary Appointment Portal');
assert.equal(isAutomaticallyDerivedProjectName('cree une mini calculatrice', 'cree une mini calculatrice'), true);
assert.equal(sanitizeSuggestedProjectName('  Orbit Tasks  ', 'todo app'), 'Orbit Tasks');
assert.equal(sanitizeSuggestedProjectName('this name is far too long and should never become the project title because it is a sentence', 'todo app'), 'TaskFlow');

// A published project's slug is the link the user shares; it must survive both
// a manual rename and a regeneration that renames the project automatically.
assert.equal(
  canReassignProjectSlug({ currentName: 'TaskFlow', nextName: 'TaskFlow Pro', hasLiveDeployment: true }),
  false,
);
assert.equal(
  canReassignProjectSlug({ currentName: 'TaskFlow', nextName: 'TaskFlow Pro', hasLiveDeployment: false }),
  true,
);
// An unchanged name never costs a slug lookup, published or not.
assert.equal(
  canReassignProjectSlug({ currentName: 'TaskFlow', nextName: 'TaskFlow', hasLiveDeployment: false }),
  false,
);

console.log('project naming tests passed');
