import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

/*
 * The gate reads the book that will be debited.
 *
 * There are two credit ledgers here. `credit_wallets` holds one number for the
 * account and is what every paid action checks before it runs.
 * `credit_grants` is per category and per expiry, and is what
 * `coden_billing_reserve` actually debits. They disagree, and the gate was
 * reading the wrong one.
 *
 * Production, 13 September, account 1be75fb9: the wallet said 30 credits, the
 * eligible `ai_gateway` grants said 0 — build credits are re-issued daily, the
 * AI allowance is monthly and had been spent. Two chats passed the gate,
 * OpenRouter was called and paid, the answers were generated and saved, and
 * both were then discarded with PROVIDER_QUOTA_OR_BILLING.
 */
{
  assert.match(server, /async function unifiedCategoryCredits\(/,
    'the balance of the debiting ledger is readable');

  /*
   * The predicate must mirror the RPC's own WHERE clause. An approximation
   * reintroduces the same disagreement in miniature: a grant the check counts
   * and the reservation skips puts us straight back to refusing after payment.
   */
  const fn = server.slice(
    server.indexOf('async function unifiedCategoryCredits('),
    server.indexOf('async function reserveUnifiedUsage('),
  );
  assert.match(fn, /\.eq\('account_id', accountId\)/, 'scoped to the account, as the RPC is');
  assert.match(fn, /\.in\('usage_restriction', \[category, 'general'\]\)/, 'same category rule');
  assert.match(fn, /\.is\('frozen_at', null\)/, 'same frozen rule');
  assert.match(fn, /\.gt\('expires_at', new Date\(\)\.toISOString\(\)\)/, 'same expiry rule');
  assert.match(fn, /\.gt\('credits_remaining', 0\)/, 'same exhaustion rule');

  /*
   * Fail open. A read outage on a balance must not lock every customer out of
   * the product; the reservation still guards the actual debit, so the worst
   * case is the behaviour that existed before this check.
   */
  assert.match(fn, /return Number\.POSITIVE_INFINITY;[\s\S]*\}\s*$/,
    'a failed read does not become a refusal');
  assert.match(fn, /\[coden:unified_balance_unavailable\]/, 'and it is visible to an operator');

  // Both books are consulted before the model is called, not one of them.
  assert.match(server, /if \(wallet < estimate\.finalCredits \|\| aiCredits < estimate\.finalCredits\) \{/,
    'the chat gate checks both ledgers');
  const gateAt = server.indexOf('const aiCredits = await unifiedCategoryCredits(userId, \'ai_gateway\');');
  const modelAt = server.indexOf('const content = redactSecrets(agentText.text');
  assert.ok(gateAt > 0, 'the AI balance is read in the chat path');
  assert.ok(gateAt < modelAt, 'and read BEFORE the model is called, which is the entire point');
}

/*
 * A refusal to bill never destroys work that is already done.
 *
 * The charge sat behind a bare `await`. When the ledger refused, the exception
 * unwound past the response into the error handler, and the customer was told
 * the model was unavailable — after it had answered, after OpenRouter had been
 * paid, and after the reply had been written to the conversation.
 *
 * The same rule already held in the pipeline branch, which logs and continues.
 * The chat path was the inconsistent one.
 */
{
  const charge = server.slice(
    server.indexOf('const chargedCredits = agentText.model === \'auto\''),
    server.indexOf('return res.json({\n      success: true,\n      request_id: requestId,\n      text: content,'),
  );
  assert.ok(charge.length > 0, 'the chat charge block is where it was');
  assert.match(charge, /try \{[\s\S]*chargeCompletedAgentAction\([\s\S]*\} catch \(chargeError/,
    'the charge cannot unwind the response');
  assert.match(charge, /\[coden:chat_charge_failed\]/, 'a shortfall is recorded instead');
  assert.match(charge, /provider_cost_usd: Number\(agentText\.cost_usd/,
    'with what was actually spent, so the debt can be reconciled');

  // And the money already spent is named in the log, not silently dropped.
  assert.match(charge, /account_id: userId/, 'against the account that owes it');
}

/*
 * The message the customer gets is the true one.
 *
 * `CREDITS_REQUIRED` and its "top up your balance" text already existed; it
 * simply never fired, because the gate that produces it was reading the ledger
 * that always said yes. What fired instead was PROVIDER_QUOTA_OR_BILLING,
 * whose card reads "the model is temporarily unavailable" and offers a retry
 * and a switch to Auto — two remedies that cannot help an empty AI allowance,
 * and a retry that spends real money to fail identically.
 */
{
  assert.match(server, /diagnostic_code: 'CREDITS_REQUIRED'/, 'the honest code still exists');
  /*
   * Checked as "the locale is derived from the prompt", not as one exact line:
   * the first version of this assertion pinned the call's formatting and broke
   * the moment a second argument was added, on behaviour that had not changed.
   */
  assert.match(server, /publicCreditGateResponse\(\s*\n?\s*isLikelyFrenchPrompt\(prompt\),/,
    'and the chat gate answers in the language the customer wrote in');
}

console.log('credit gate tests passed');
