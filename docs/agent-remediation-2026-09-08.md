# Agent reliability remediation — 2026-09-08

Scope: the agent runtime, not a redesign. Existing user edits to builder.css are excluded.
Source repository: Braand-web/coden. Intended service: coden-production, coden.fun.

## Implemented

- Fixed the ambiguous reservation_id PL/pgSQL variable through a CREATE OR REPLACE migration. The existing function and grants were preserved; a reserve/replay/release transaction was tested and rolled back before applying the patch.
- Production verification on ftmbiocvslxctldfihcp: corrected=true; anon_can_execute=false; authenticated_can_execute=false.
- Shared project build permission and explicit critical-action guards before the early multi-agent branch.
- Mission, conversation context and approved plan carried into planning/coding and all repair rounds. At most three selected writer skills, not the whole catalogue.
- Planner receives ranked, explicitly truncated source excerpts, not only filenames.
- Manual coder selections stay pinned and must pass plan, tool and modality gates. Image attachments reach the coder as multimodal input.
- File reads use pagination. Tool payload serialization remains valid JSON. Nonzero exit codes are failures.
- Real file revision comparison prevents no-op/reverted work from passing as implementation.
- Failed installation/start remains available to the repair agent. Configuration changes trigger runtime refresh; unchanged previews reuse the actual running URL.
- Abort signals reach installs, commands and validation. Command timeouts terminate the process group/tree and bound captured output.
- A host-local writer lease prevents competing pipeline writers and protects active runs from eviction. This is not a distributed lease.
- File tools reject symlink/junction paths. This is not OS-level process isolation.
- Stream deltas are coalesced and transient persistence failures retried in order. A permanent journal failure never emits run_finished.
- Structured final report no longer requires an extra unmetered model call.
- Required pending/failed checks prevent completed turns. Delivered conversational answers use conversational completion criteria rather than build criteria.
- Provider USD and credit counters are distinct. Round-spend persistence is awaited.
- Browser storage regression now discovers the installed Playwright browser on Windows instead of silently skipping it.

## Not yet resolved — do not describe this release as the complete V4

- Generated processes still share the host with the control plane. Separate, genuinely isolated execution infrastructure is required.
- The early pipeline still needs complete per-provider-call reservations, accounting, settlements and invoice reconciliation, including planner and interrupted calls. The reservation SQL fix and USD counter fix do not constitute a fully reconciled Billing V2.
- Automated request-specific functional scenarios (CRUD/Auth/payment/persistence) and independent behavior verification are incomplete. A passing render/build is not sufficient: affected turns remain verification-incomplete.
- Durable distributed leases/fencing and recovery of executing processes across host restarts are not implemented by the host-local lease.
- Journal retry idempotency must also be enforced in the database; client sequence deduplication is not sufficient alone.
- Full streaming restoration and preservation of all preview state across browser reloads still require end-to-end validation.
- No claim of zero bugs, complete V4 delivery, or production-ready isolation is made.

## Release validation

Run npm run lint, npm run test:unit, npm test, npm run build.
Also execute test-browser-interaction-runner.ts with the real installed Chromium.
Validated locally: typecheck passed; 106 unit tests passed; the full npm test script passed;
production build passed; browser interaction/storage checks passed with real Chromium.
A supplementary project-sandbox rerun after switching to restricted Windows execution
failed because esbuild could not read an ancestor directory (Access is denied).
The same test passed in the full suite before that restriction. This supplemental
environment check is not counted as passed; verify the actual Linux runtime after deployment.
Verify the deployed commit through Railway and /api/health, then check public pages and a browser-rendered page.
Never publish tokens, .env files or provider credentials.

## Rollback

Application checkpoint: checkpoint/agent-audit-c409e2a (c409e2a6f1571647a43ce19b197caaaa62c432a2).
Rollback the application to the previous healthy deployment if the healthcheck regresses.
The SQL correction is backwards-compatible; do not revert it merely because the app rolls back.
No historical billing data or user projects were removed.
# Production follow-up — usage event compatibility

The first production check confirmed commit `2b19ff6` and all seven public HTTP routes. Runtime logs then exposed a second pre-existing migration mismatch: V4 event inserts omitted legacy NOT NULL `organization_id` and `action_type`. The writer now resolves the organization from the billing account, preserves legacy cost/model fields, and scopes duplicate recovery to the same account and organization. No constraint or RLS protection was removed. A dedicated executable regression covers account mapping, legacy fields, duplicate replay, foreign duplicate rejection and persistence failure; typecheck passed after this correction.
