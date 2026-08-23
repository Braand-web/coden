import assert from 'node:assert/strict';
import { detectCodenCloudRequirements } from './src/services/coden-cloud.ts';
import {
  applyCodenFullstackKit,
  shouldApplyCodenFullstackKit,
  validateCodenFullstackFiles,
} from './src/services/fullstack-generation.ts';
import { inferProductionBlueprint } from './src/services/production-blueprints.ts';

const prompt = 'Create a CRM with login, clients, notes, invoices, uploads and persistent database.';
const requirement = detectCodenCloudRequirements(prompt);
const baseFiles = [
  {
    path: 'package.json',
    language: 'json',
    content: JSON.stringify({
      scripts: {
        dev: 'vite',
        build: 'vite build',
        test: 'node --experimental-strip-types src/app.test.ts',
        lint: 'tsc --noEmit',
      },
      dependencies: {
        react: 'latest',
        'react-dom': 'latest',
      },
    }, null, 2),
  },
  {
    path: 'src/App.tsx',
    language: 'tsx',
    content: 'export default function App() { return <button onClick={() => null}>Save client</button>; }',
  },
];

assert.equal(shouldApplyCodenFullstackKit({ prompt, files: baseFiles, requirement }), true);

// Deterministic, blueprint-driven detection: any prompt the production blueprint
// engine classifies as data-backed must trigger the fullstack kit, even with no
// generated files yet and without relying on the brittle keyword list.
for (const dataBackedPrompt of [
  'Build a social network feed where users follow each other and post updates',
  'Create a patient records system for a small clinic',
  'An online education platform with courses, lessons and quizzes',
]) {
  const blueprint = inferProductionBlueprint(dataBackedPrompt);
  if (blueprint.backend.requiresDatabase || blueprint.backend.requiresAuth) {
    assert.equal(
      shouldApplyCodenFullstackKit({
        prompt: dataBackedPrompt,
        files: [],
        requirement: detectCodenCloudRequirements(dataBackedPrompt),
      }),
      true,
      `Expected fullstack kit for data-backed blueprint: ${dataBackedPrompt}`,
    );
  }
}

const files = applyCodenFullstackKit({
  files: baseFiles,
  projectName: 'CRM',
  prompt,
  requirement,
});

const byPath = new Map(files.map(file => [file.path, file.content]));

assert.ok(byPath.has('src/lib/codenCloud.ts'));
assert.ok(byPath.has('src/lib/appData.ts'));
assert.ok(byPath.has('src/lib/validation.ts'));
assert.ok(byPath.has('src/lib/authGuard.ts'));
assert.ok(byPath.has('coden/backend-plan.json'));
assert.ok(byPath.has('supabase/migrations/0001_coden_fullstack.sql'));
assert.ok(byPath.has('supabase/functions/_shared/security.ts'));
assert.ok(byPath.has('supabase/schema.sql'));
assert.ok(byPath.has('src/fullstack.test.ts'));
assert.match(byPath.get('package.json') || '', /@supabase\/supabase-js/);
assert.match(byPath.get('package.json') || '', /"zod"/);
assert.match(byPath.get('package.json') || '', /src\/fullstack\.test\.ts/);
assert.match(byPath.get('supabase/schema.sql') || '', /enable row level security/i);
assert.match(byPath.get('supabase/schema.sql') || '', /grant usage on schema public to anon, authenticated/i);
assert.match(byPath.get('supabase/schema.sql') || '', /create policy "Users can read their records"/i);
assert.match(byPath.get('supabase/schema.sql') || '', /create table if not exists public\.app_contacts/i);
assert.match(byPath.get('supabase/schema.sql') || '', /create table if not exists public\.app_deals/i);
assert.match(byPath.get('supabase/schema.sql') || '', /create table if not exists public\.app_audit_logs/i);
assert.match(byPath.get('supabase/schema.sql') || '', /alter table public\.app_contacts enable row level security/i);
assert.match(byPath.get('supabase/schema.sql') || '', /create policy "Members can read app_contacts"/i);
assert.match(byPath.get('supabase/schema.sql') || '', /storage\.buckets/i);
assert.match(byPath.get('supabase/schema.sql') || '', /storage\.objects/i);
assert.match(byPath.get('src/lib/appData.ts') || '', /requireCodenCloud|CODEN_CLOUD_NOT_CONFIGURED/);
assert.match(byPath.get('src/lib/validation.ts') || '', /z\.object/);
assert.match(byPath.get('src/lib/authGuard.ts') || '', /requireAppUser/);
assert.match(byPath.get('coden/backend-plan.json') || '', /"migrations_require_confirmation": true/);
assert.match(byPath.get('supabase/functions/_shared/security.ts') || '', /assertRateLimit/);
assert.match(byPath.get('supabase/functions/_shared/security.ts') || '', /assertWebhookSignature/);
assert.doesNotMatch(files.map(file => file.content).join('\n'), /service[_-]?role|SUPABASE_SERVICE_ROLE|sbp_|secret eyJ/i);

const checks = validateCodenFullstackFiles(files, requirement);
assert.equal(checks.filter(check => check.status === 'fail').length, 0, checks.map(check => `${check.key}: ${check.message}`).join('\n'));
assert.ok(checks.some(check => check.key === 'fullstack_client_present'));
assert.ok(checks.some(check => check.key === 'fullstack_rls_enabled'));
assert.ok(checks.some(check => check.key === 'fullstack_data_api_grants'));
assert.ok(checks.some(check => check.key === 'fullstack_all_private_tables_rls'));
assert.ok(checks.some(check => check.key === 'fullstack_zod_validation'));
assert.ok(checks.some(check => check.key === 'fullstack_rate_limit_helper'));
assert.ok(checks.some(check => check.key === 'fullstack_auth_guard_present'));
assert.ok(checks.some(check => check.key === 'fullstack_backend_plan_present'));
assert.ok(checks.some(check => check.key === 'fullstack_versioned_migration_present'));
assert.ok(checks.some(check => check.key === 'fullstack_storage_policies'));

const crmFilesWithPromptLanguage = [
  ...files,
  {
    path: 'docs/product-notes.md',
    language: 'markdown',
    content: 'The onboarding copy mentions prompt workspace, app_prompts, app_generations and streamAiResponse as examples, but this CRM is not an AI streaming product.',
  },
];
const crmPromptLanguageChecks = validateCodenFullstackFiles(crmFilesWithPromptLanguage, requirement);
assert.equal(
  crmPromptLanguageChecks.filter(check => check.status === 'fail').length,
  0,
  crmPromptLanguageChecks.map(check => `${check.key}: ${check.message}`).join('\n'),
);
assert.ok(!crmPromptLanguageChecks.some(check => /^fullstack_ai_stream_/.test(check.key)), 'Non-AI apps must not be blocked by AI stream connector checks.');

const marketplace = inferProductionBlueprint('Build a marketplace with sellers products orders payments and reviews');
assert.equal(marketplace.type, 'marketplace');
assert.ok(marketplace.tables.some(table => table.name === 'app_sellers'));
assert.ok(marketplace.tables.some(table => table.name === 'app_orders'));
assert.ok(marketplace.backend.requiresBilling);

const marketplaceRequirement = detectCodenCloudRequirements('Build a marketplace with sellers products orders payments storage and Stripe checkout');
const marketplaceFiles = applyCodenFullstackKit({
  files: baseFiles,
  projectName: 'Marketplace',
  prompt: 'Build a marketplace with sellers products orders payments storage and Stripe checkout',
  requirement: marketplaceRequirement,
});
const marketplaceByPath = new Map(marketplaceFiles.map(file => [file.path, file.content]));
assert.ok(marketplaceByPath.has('src/lib/paymentActions.ts'));
assert.ok(marketplaceByPath.has('supabase/functions/stripe-webhook/index.ts'));
assert.match(marketplaceByPath.get('src/lib/paymentActions.ts') || '', /createCheckoutSession/);
assert.match(marketplaceByPath.get('supabase/functions/stripe-webhook/index.ts') || '', /STRIPE_WEBHOOK_SECRET/);
assert.match(marketplaceByPath.get('supabase/functions/stripe-webhook/index.ts') || '', /assertWebhookSignature/);
const marketplaceChecks = validateCodenFullstackFiles(marketplaceFiles, marketplaceRequirement);
assert.equal(marketplaceChecks.filter(check => check.status === 'fail').length, 0, marketplaceChecks.map(check => `${check.key}: ${check.message}`).join('\n'));
assert.ok(marketplaceChecks.some(check => check.key === 'fullstack_payment_actions_present'));
assert.ok(marketplaceChecks.some(check => check.key === 'fullstack_stripe_webhook_signature'));

console.log('test-fullstack-generation passed');
