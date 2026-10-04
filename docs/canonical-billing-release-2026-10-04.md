# Canonical billing release

## Scope

The only commercial source is `src/config/billing-v2.ts`. Public prices,
credit tiers, annual discount, top-ups, model entitlements and composer choices
are unchanged. Conversation costs 0.5 credit; generated actions use the
canonical 0.5 / 0.9 / 1 / 1.2 / 1.7 action table. Provider cost is accounting
metadata, never a second customer tariff.

Active V3 code, its public API and admin editor are removed. Historical SQL,
transactions and archived pricing versions remain financial evidence. SQL
activation of a V3 version is permanently denied, including to service_role.

## Delivery and financial integrity

Requests require a stable client identifier, scoped by account, project and
endpoint. A fingerprint rejects reuse for different inputs or conversation
branches. Reserve before paid work; failed work releases its reservation.
The sole approved exception is internal intent classification: at most two
Coden-funded calls capped at USD 0.05 each including purchase fees, no tools,
fallbacks or explicit cache-write surcharge. Attachment work follows reservation.

SQL atomically commits the replayable result, accounting checkpoint, assistant
message and (for generated apps) source/preview snapshot. A marker makes the
whole delivered snapshot authoritative until normalized file mirroring succeeds.
Intermediate rounds cannot overwrite it. Delivered reservations cannot be
refunded by an auxiliary bookkeeping failure. A persistent worker retries
usage-event creation and settlement idempotently after restart.

Free grants are one-time across legacy and new references. Existing valid
credits and expiry are retained; no retroactive charges or extra gifts.
Saspay confirmation checks HMAC/timestamp, provider transaction identity,
payment type/direction, amount and currency. Repeated webhooks are acknowledged
without another grant. Annual installments retain the original UTC anniversary;
missed still-valid installments are recoverable, expired credits are not revived.

## Validation

Run the unit suite, TypeScript checks, build and security audit. Run all root
contract tests. Financial integration uses a synthetic local PostgreSQL database
only, guarded to loopback port 15493. The financial suite covers all six prices
on all three plans, exact fractions, concurrent reservations/settlements,
rollback, replay, expiry, cross-account access and durable app delivery. The
Cloud suite separately validates consent and grace budgets/time boundaries.
Saspay tests use mocked test-provider responses; no real purchase is performed.

`scripts/billing-readonly-check.mjs` creates an atomic private financial backup
and reconciles grant balances, reservations and immutable ledger entries.
`scripts/billing-production-release.mjs` refuses in-flight reservations,
unreconciled accounts, stale/incomplete backups, an unpaused paid-work flag or
enabled unvalidated Cloud billing. Migration and migration journal commit together.
Credentials arrive on stdin only; backups and test credentials stay outside Git.

`scripts/billing-production-smoke.mjs` uses one controlled, non-exempt Free
account, its normal signup grant and one actual conversational action. It checks
5 to 4.5 credits, identical replay without a second debit, cancellation release,
project reload/history persistence, retired V3 API and disabled Cloud collectors.
It does not impersonate a customer or make a live payment. Preserve its immutable
financial evidence rather than deleting ledger history.

## Cutover and rollback

1. Set `CODEN_PAID_OPERATIONS_PAUSED=1` and
   `CODEN_CLOUD_MEASURED_BILLING_V1=0` in Railway. Deploy the validated code.
2. While new paid work is paused, take a fresh atomic backup and reconcile.
   Apply only the two approved migrations to central Coden
   `ftmbiocvslxctldfihcp`, not App Runtime `hhktmwppxsbdeyqkxaal`.
3. Verify real SQL permissions/RLS and the migration journal. Reload Data API.
   Unpause with `CODEN_PAID_OPERATIONS_PAUSED=0`, verify the active deployment
   and run the production smoke test.
4. If a financial check fails, pause new paid work again. Keep published static
   apps, project data and ledger history. Do not restore an unlimited mode,
   reactivate V3 or overwrite balances from a backup. Repair forward using
   the persisted delivery/settlement journal.

## Cloud stage remains disabled

The versioned reference tariff, owner-consent API/UI and tested 72-hour grace
framework are scaffolding, not a validated usage collector. No old Cloud usage
is billed. Activation is blocked until real per-app attribution, exclusions,
runtime suspension gates, included-email quota enforcement and owner
notifications are implemented and tested. Static publication, Coden central
resources and user-paid external accounts remain excluded. Do not enable the
Cloud flag merely because its schema and local grace tests pass.
