import assert from 'node:assert/strict';
import {
  buildCodenCloudSchemaName,
  detectCodenCloudRequirements,
  hasCodenCloudRequirement,
  summarizeCodenCloudRequirements,
} from './src/services/coden-cloud.ts';

{
  const result = detectCodenCloudRequirements('Crée un CRM avec login, clients, factures et notes.');
  assert.equal(result.needs_auth, true);
  assert.equal(result.needs_database, true);
  assert.equal(result.needs_storage, false);
  assert.equal(result.recommended_mode, 'shared');
  assert.ok(result.detected_from_prompt.includes('auth'));
  assert.ok(result.detected_from_prompt.includes('database'));
  assert.equal(hasCodenCloudRequirement(result), true);
}

{
  const result = detectCodenCloudRequirements('Build a marketplace with vendors, products, orders and product photos.');
  assert.equal(result.needs_auth, true);
  assert.equal(result.needs_database, true);
  assert.equal(result.needs_storage, true);
  assert.equal(result.recommended_mode, 'shared');
}

{
  const result = detectCodenCloudRequirements('Add Stripe webhook handling, email notifications, and webhook secret storage.');
  assert.equal(result.needs_edge_functions, true);
  assert.equal(result.needs_secrets, true);
  assert.equal(result.needs_database, false);
}

{
  const result = detectCodenCloudRequirements('Create a static landing page for a design studio.');
  assert.equal(hasCodenCloudRequirement(result), false);
  assert.equal(result.summary, 'No managed backend required.');
}

{
  const result = detectCodenCloudRequirements('Crée une application de tâches sans backend, avec localStorage et sans service externe.');
  assert.equal(hasCodenCloudRequirement(result), false, 'An explicit local-only request must not become a managed database app.');
  assert.equal(result.needs_database, false);
  assert.equal(result.needs_auth, false);
  assert.deepEqual(result.detected_from_prompt, ['local_only']);
}

{
  const result = detectCodenCloudRequirements('Create a business CRM with a dedicated isolated backend for compliance.');
  assert.equal(result.needs_database, true);
  assert.equal(result.recommended_mode, 'dedicated');
  assert.match(summarizeCodenCloudRequirements(result), /dedicated/);
}

{
  assert.equal(buildCodenCloudSchemaName('ABC-123 hello'), 'app_abc_123_hello');
  assert.equal(buildCodenCloudSchemaName(''), 'app_project');
}

console.log('test-coden-cloud passed');
