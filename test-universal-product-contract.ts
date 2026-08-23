import assert from 'node:assert/strict';
import {
  buildUniversalProductContract,
  universalProductContractPromptContext,
} from './src/services/universal-product-contract.ts';

{
  const contract = buildUniversalProductContract('Crée un outil web pour organiser des répétitions musicales avec invitations et fichiers audio.');
  assert.match(contract.goal, /répétitions musicales/i);
  assert.equal(contract.productShape.includes('predefined app category'), true);
  assert.equal(contract.dataPolicy.allowUserFacingFixtures, false);
  assert.equal(contract.dataPolicy.emptyStateRequired, true);
  assert.ok(contract.capabilities.includes('file and media handling'));
  assert.ok(contract.acceptanceCriteria.some(item => /No invented/i.test(item)));
}

{
  const contract = buildUniversalProductContract('Create an offline timer that saves sessions in localStorage.');
  assert.equal(contract.dataPolicy.persistence, 'local_requested');
  const context = universalProductContractPromptContext(contract);
  assert.match(context, /never product-shape constraints/i);
  assert.match(context, /Never invent user-facing data/i);
}

console.log('universal product contract tests passed');
