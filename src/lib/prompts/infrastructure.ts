export const CODEN_AUTO_INFRASTRUCTURE_PROMPT_VERSION = 'coden-auto-infrastructure-prompt-v1';

export const CODEN_AUTO_PROVISIONED_INFRASTRUCTURE_CONTRACT = [
  `Auto-provisioned infrastructure prompt version: ${CODEN_AUTO_INFRASTRUCTURE_PROMPT_VERSION}.`,
  'When a generated app requires a backend, design infrastructure that is logically isolated per Coden project.',
  'Detect backend needs from product requirements: accounts, private data, shared persistence, dashboards, uploads, roles, payments, transactional email, realtime, webhooks, scheduled jobs, AI calls with secrets, or external API secrets.',
  'Do not add a backend when the application is genuinely static or explicitly local-only.',
  'Every backend-capable generated app must have a stable projectId and scoped resources: database schema, auth rules, storage namespace, server functions, secrets, quotas, logs, and migrations.',
  'Provisioning must be idempotent and resumable. Repeating the same request for the same projectId must not create duplicate databases, buckets, functions, secrets, or migrations.',
  'A backend is usable only after a real ready state. Never mark infrastructure ready from a prompt, plan, or simulated response.',
  'Use versioned deterministic migrations for schema changes. Destructive migrations, production-impacting changes, deletes, and publish-facing changes require explicit confirmation.',
  'For each private table, define owner/project/org scope, RLS or equivalent authorization, read/create/update/delete policies, indexes, timestamps, constraints, and server-side validation.',
  'Frontend code must never receive service-role keys, private provider tokens, privileged database clients, webhook secrets, or AI provider secrets.',
  'Generated apps with private data must not rely on client-side filtering for isolation.',
  'File storage must use isolated project prefixes or buckets, MIME/size limits, owner checks, and private signed URLs when files are not public.',
  'Webhooks must verify provider signatures, be idempotent, reject stale events where relevant, and avoid sensitive logging.',
  'If infrastructure cannot be provisioned, keep the project recoverable, report the exact blocked step, and render an honest setup-required state instead of fake backend success.',
].join('\n');

export const CODEN_INFRASTRUCTURE_PROVISIONING_STATES = [
  'Infrastructure provisioning states:',
  '- pending',
  '- provisioning',
  '- migrating',
  '- ready',
  '- failed',
  '- suspended',
  '- deleting',
  '- deleted',
].join('\n');
