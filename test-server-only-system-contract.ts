import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const clientEntryFiles = [
  'src/builder-live.ts',
  'src/auth.ts',
  'src/settings-panel.ts',
  'src/builder-conversation-island.tsx',
];

for (const relativePath of clientEntryFiles) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  assert.ok(
    !source.includes('agent-prompt-stack') && !source.includes('coden-system-contract'),
    `${relativePath} must not import or expose server-only Coden prompts`,
  );
}

const viteConfig = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
assert.ok(!viteConfig.includes('process.env.GEMINI_API_KEY'), 'Vite must never inject GEMINI_API_KEY into client bundles');
assert.ok(!viteConfig.includes('loadEnv('), 'Vite config must not load unrestricted server environment variables');

const systemContract = fs.readFileSync(path.join(root, 'src/services/coden-system-contract.ts'), 'utf8');
assert.ok(systemContract.includes('coden-system-contract-v2'), 'system contract version must be v2');
assert.ok(systemContract.includes('Product engineering operating contract'), 'system contract must include the full product engineering layer');
assert.ok(systemContract.includes('Do not trust user_id, owner_id, role, plan, credits, org_id'), 'system contract must guard server authorization boundaries');
assert.ok(systemContract.includes('Persist the user message early with a stable id'), 'system contract must preserve chat persistence semantics');
assert.ok(systemContract.includes('Never claim preview, publish, build, tests, security, database, or integration success'), 'system contract must enforce no-fake-success completion');

console.log('server-only system contract ok');
