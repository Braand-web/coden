# Preview retention, backend method and complimentary entitlements

## Changes

- The Builder keeps an existing live iframe, browser runtime or usable HTML when cancellation, an empty response or a loading placeholder arrives. The generation state no longer unmounts the existing application. Existing snapshot/resume paths and real-runtime restart remain in place. This does not guarantee permanent sandbox uptime or restore unsaved in-app form state after a full reload.
- `senior-backend` is a concise Coden-specific method available through the existing optional `load_skill` tool. It emphasizes authorization, transactions, idempotency, reversible migrations and measured performance. The supplied Python scripts and reference documents are not installed or advertised as available.
- The subscription schema accepts `provider = admin` for a complimentary, non-recurring contract. Database constraints require zero payment revenue, no next scheduled credit grant, explicit dates and an `admin:` reference. RLS and table/function grants are unchanged. Expiry processing now handles these contracts and preserves any other active subscription.
- The normal admin-console credit ceiling remains unchanged. The owner's one-time production attribution uses a reviewed SQL transaction, stable idempotency reference, credit ledger and admin audit entry. No payment webhook, checkout or purchase record is fabricated.

## Validation

TypeScript and build pass. Unit suite: 190 files, 1,462 tests. Regression coverage includes live/saved/browser-runtime retention, rejection of empty preview replacements, optional backend method, subscription expiry and preservation of another active plan. Production SQL checks verified RLS and absence of anon/authenticated writes or grant-function execution before the change. A targeted pre-change record is stored outside Git; it is not a full database backup.

## Limits

A fresh browser session with a real in-flight generation stopped by the user remains a separate end-to-end check. Unit tests and build are not represented as a real-model generation test. No user application was rewritten, migrated or regenerated for this release.
