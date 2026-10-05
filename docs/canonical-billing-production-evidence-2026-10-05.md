# Canonical billing — production verification, 5 October 2026

## Shipped stage

The canonical Free / Pro / Business catalogue and fixed action debits are live.
No subscription prices, tiers, annual discount, top-up prices, model menu or
reasoning options were changed. Active V3 routes, calculations and admin writes
were removed; historical financial records remain archived and unactivatable.

Conversation costs 0.5 credit. The other canonical prices remain style 0.5,
component 0.9, planning 1, feature 1.2 and full page 1.7. Exact atomic reservations
precede paid execution, except the explicitly approved capped internal router.
Durable delivery precedes settlement; a persistent outbox retries accounting.

## Migrations and backup

Only central Coden `ftmbiocvslxctldfihcp` was migrated. App Runtime
`hhktmwppxsbdeyqkxaal` was not modified.

- `20261003131955_canonical_billing_fixed_debits.sql`, SHA-256
  `d0a7d1c9953cfc412432eded9d021a59d5e5b5e5f4a3eb5ee6f62be16e9ad075`.
- `20261004062311_cloud_billing_consent_and_grace.sql`, SHA-256
  `59aed2c5898edc2f8b88f624cc0913e31798b63a9c06fceb864bf6e11e1dc43a`.

An atomic private financial/schema export was taken before migration. Initial
reconciliation covered 23 accounts with zero unexplained delta and zero open
reservations. All 84 historical grants and 116 ledger entries retained their
amounts and validity. No credits were revived, gifted or charged retroactively.

The first migration attempt rolled back because PostgreSQL requires preserving
the existing optional refund-reason parameter. The corrected signature was
retested against the original function before successful application.

Real production checks confirmed RLS on seven private tables, browser-role
denial and server-only access to seven financial functions, denied V3 activation
and exact migration-journal hashes. Credentials and backups remain outside Git.

## Production proof

At `2026-10-05T02:21:48Z`, on the deployed `5f694df` revision including this
billing release, a controlled, non-exempt Free account completed these checks:

- Its normal one-time signup grant: 5 credits, then exactly 4.5 after one reply.
- Replaying the same action returned the same result with one usage entry only.
- A 0.9-credit pre-delivery cancellation returned the reservation exactly once.
- Reopening the project retained the delivered assistant text.
- Authenticated V3 pricing API returned 404.
- The Cloud usage API reported that measured collectors are disabled.

An interrupted local network test left its own cancellation reservation open.
The ledger showed one settled 0.5-credit action, not an incorrect 1.4-credit debit.
Only that controlled reservation was released. The test now persists its nonce
before reservation and safely resumes after transport interruption.

No real Saspay payment or purchase was made. Valid, invalid and repeated payment
notifications were tested with mocked provider responses. Published pages and
service health responded successfully.

## Validation and operational controls

The full unit suite passed 1,506 tests before the final concurrent preview repair
was incorporated; its changed preview/billing tests then passed separately.
PostgreSQL integration passed 102 financial checks and 47 Cloud checks, including
concurrent operations. TypeScript, production build, security boundaries and
the production dependency vulnerability audit passed.

`CODEN_PAID_OPERATIONS_PAUSED=0` restores paid work after validation.
For a financial incident set it to `1`: preserve projects, published apps and
the ledger, repair forward, never re-enable V3 or unlimited billing.

## Not activated: measured Cloud billing

`CODEN_CLOUD_MEASURED_BILLING_V1=0`. The tariff, consent API and 72-hour grace
schema are scaffolding only. Per-app collectors, reliable attribution, runtime
suspension gates, included-email enforcement and owner notifications still need
implementation and validation. No historical Cloud consumption is billed.
This release is stage one, not completion of that remaining Cloud stage.
