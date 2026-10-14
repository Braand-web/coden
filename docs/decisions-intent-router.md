# Coden intent routing with GPT-6 Luna Decisions

The internal classifier uses `openai/gpt-6-luna-decisions` through
`POST https://openrouter.ai/api/alpha/decisions`. It is deliberately absent from
the public chat/coding model catalogue. The developer, planner, media tools,
publication and permissions continue through their existing services.

## Modes

- `CODEN_DECISIONS_ROUTER_MODE=active` (default): use a validated, high-confidence
  standalone classification. Otherwise use the existing generative chat router.
- `shadow`: the chat router owns the action. Compare a sampled Decisions answer
  asynchronously, without adding interactive latency.
- `off`: immediate rollback to the previous chat path.

`CODEN_DECISIONS_ROUTER_SAMPLE_RATE` defaults to `0.10` and is bounded to 0–1.
It only affects shadow mode. An invalid mode disables the new path.

## What is and is not delegated

Decisions classifies intent, context dependence, complexity, planning needs,
research needs and explicitly requested media. Only intent, confident complexity
and a confident planning judgement can influence routing in active mode.
Research/media judgements are observational: they cannot call tools, authorize
a purchase, grant a permission, bypass a confirmation or change billing.

A standalone mutation requires confidence and winning probability >= 0.90,
a margin >= 0.25, confidently standalone context and confidently classified
complexity/planning needs. Read-only requests require >= 0.80 with >= 0.15
margin. These are conservative starting thresholds, not calibrated accuracy
guarantees. Contextual replies (`oui`, `continue`, option selections), missing
targets, clarifications and publication requests retain the generative router.
Decisions cannot synthesize the self-contained `normalized_prompt` required by
the developer, so earlier conversation is never reconstructed heuristically.

The existing mode guard and execution contract still run after classification.
Plan mode, pre-charge local classification and social-message guards retain
their existing deterministic paths. The media consent service remains the
authority for paid assets.

## Transport and spend

The adapter reads the server's existing OpenRouter key resolver, including
encrypted keys. No new secret or browser variable is needed. Prices and
decision modality are verified against the separate public catalogue:
`GET /api/v1/models?output_modalities=decisions` (five-minute cache).
Unknown pricing, nonzero output pricing or price overrides stop the call.
The response may use the alias or its exact dated canonical model verified in
that catalogue; arbitrary aliases/versions and untrusted provider names are rejected.

Both classifiers share at most two paid calls per request, each bounded to
$0.05 including the existing 5.5% purchase fee allowance. A Decisions call
uses no paid retry, provider fallback, tool, search or cache write. It pins
OpenAI and price ceilings, bounds input and response sizes, times out after
five seconds, caps concurrency at four and opens a one-minute breaker after
three failures. A paid Decisions attempt leaves one chat call, without a
third repair call. A shadow observation is skipped if the chat repair used
the second call. These calls do not debit customer Coden credits.

`[coden:decisions_intent]` logs mode, acceptance/fallback reason, classification,
confidence, comparison, latency, cost and call count; no user content or keys.
The existing optional cost-observation writer records provider usage under
`classification`, using its existing pseudonymized request/account scope.
Unknown usage remains unknown, never a fabricated zero. Upstream error bodies
are discarded.

## Verification and rollout

Run deterministic transport/contract tests and related router regressions:

```powershell
npx vitest run src/services/openrouter-decisions.test.ts src/services/decisions-intent-router.test.ts src/services/internal-routing-budget.test.ts
npm run lint
npm run build
```

With the existing server OpenRouter key supplied securely, run the real-model
evaluation (ten labelled cases, at most $0.10 including purchase fees; no
customer credit debit):

```powershell
node --import tsx scripts/eval-decisions-intent.ts --live
```

It measures actual classification, unsafe direct mutations, latency and cost.
It refuses to pretend a missing key or unknown provider receipt is a passing
evaluation. Before production, require all cases to pass, then use `shadow`
on actual traffic to inspect disagreements, confidence and tail latency.
Offline tests prove integration rules; they cannot prove model quality.

No database migration, UI change or data migration is necessary for this
integration. Production activation requires a normal server release with its
OpenRouter key, after the real-model evaluation and rollout checks above.

## Local validation, 2026-10-09

- 158 targeted unit tests pass, including 35 new Decisions tests and execution
  of the actual production wrapper/contract helpers with a mocked provider.
- Harness, intent, execution-contract, model-selection and credit-gate checks pass.
- TypeScript (`tsc --noEmit`) and the production build pass.
- The broader unit run completed with 1574 passing tests and four failures in
  pre-existing frozen-client and preview-restart tests. A separate history
  source-contract test also conflicts with pre-existing media filtering changes.
  Those files were preserved, not rewritten to force a green suite.
- The server OpenRouter key is not available locally: no paid model evaluation
  was performed and no quality/cost/latency improvement is yet claimed.
- No commit, push or production deployment was performed for this task.

Sources: [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request),
[model](https://openrouter.ai/openai/gpt-6-luna-decisions),
[OpenAI Decisions API](https://developers.openai.com/api/reference/typescript/resources/decisions/methods/create).
