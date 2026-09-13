import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
const composer = readFileSync(new URL('./src/components/agent/agent-mode-composer.tsx', import.meta.url), 'utf8');
const agentMode = readFileSync(new URL('./src/services/agent-mode.ts', import.meta.url), 'utf8');

/*
 * The premises the old advice rested on, which the product does not hold.
 *
 * "Rechargez votre solde, ou choisissez le mode Auto qui sélectionne un modèle
 * moins coûteux" was appended to every out-of-credits refusal. Three facts,
 * each independently fatal to it on the path where customers see it.
 */
{
  // One: there are two modes, and Auto is one of them, so "choose Auto" is
  // "choose the mode you are probably already in".
  assert.match(composer, /export const COMPOSER_AGENT_MODES = \['auto', 'plan'\] as const/,
    'the composer offers exactly two modes');

  // Two: Auto is the default, and anything unrecognised returns to it.
  assert.match(agentMode, /return value === 'build' \|\| value === 'plan'[\s\S]*?: 'auto';/,
    'and Auto is what an unset or unknown mode becomes');
  assert.match(server, /normalizeModelSelectionId\(req\.body\?\.modelId \|\| 'auto'\)/,
    'so a chat request arrives on Auto unless a model was explicitly picked');

  /*
   * Three, and the decisive one: a conversation's price never reads the model.
   * `estimateActionCost` returns a flat floor of 1 credit for that intent, so
   * even a customer who could follow the advice would see no change.
   */
  const conversationBranch = server.slice(
    server.indexOf("if (intent.intent === 'conversation') return costEstimator.calculateRequiredCredits({"),
    server.indexOf("if (intent.intent === 'plan') return costEstimator.calculateRequiredCredits({"),
  );
  assert.ok(conversationBranch.length > 0, 'the conversation cost branch is where it was');
  assert.doesNotMatch(conversationBranch, /selectedModelFloor|modelId|modelCreditFloor/,
    'a conversation is priced without reference to the model');
  assert.match(conversationBranch, /minimum_action_credits: 1,/, 'at a flat floor');
}

/*
 * So the clause is opt-in, and off by default.
 *
 * A remedy that cannot work is worse than no remedy: the reader spends their
 * attention on it before reaching the one that can.
 */
{
  const fn = server.slice(
    server.indexOf('function publicCreditGateResponse('),
    server.indexOf('function countLineDiffStats('),
  );
  assert.match(fn, /function publicCreditGateResponse\(french = true, autoCanHelp = false\)/,
    'the Auto clause is opt-in and defaults to off');

  // Both messages exist, and the short one carries no mode advice at all.
  assert.match(fn, /'Il ne reste pas assez de crédits pour cette action\. Rechargez votre solde pour continuer\.'/,
    'the default French message stops after the remedy that works');
  assert.match(fn, /'There are not enough credits left for this action\. Top up your balance to continue\.'/,
    'and the English one');
  const defaultAt = fn.indexOf('Rechargez votre solde pour continuer');
  assert.ok(defaultAt > 0, 'the default branch is reachable in the source');
  assert.doesNotMatch(fn.slice(defaultAt), /mode Auto/,
    'no mode advice survives past the default branch');

  // The machine-readable hint follows the same truth.
  assert.match(fn, /suggested_action: autoCanHelp \? 'use_auto' : 'top_up',/,
    'and the reported suggestion matches what was actually said');
}

/*
 * Every caller states its case rather than inheriting a default.
 *
 * There are five. None may call the two-argument form blind, because the
 * argument encodes a claim about that specific path.
 */
{
  /*
   * Balanced extraction: several call sites nest a call of their own
   * (`isLikelyFrenchPrompt(prompt)`), and a `[^)]*` capture stops at that
   * inner bracket, reporting the argument list as complete when it is not.
   */
  // Prose stripped first: a comment elsewhere quotes `publicCreditGateResponse()`
  // to explain a past bug, and that is not a call site.
  const code = server.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const calls: string[] = [];
  const needle = 'publicCreditGateResponse(';
  for (let at = code.indexOf(needle); at >= 0; at = code.indexOf(needle, at + 1)) {
    // The definition is the one preceded by `function `, not the one whose
    // arguments happen to begin with the word "french" — `frenchActivity` does
    // too, and a prefix test silently dropped three real call sites.
    if (code.slice(Math.max(0, at - 9), at) === 'function ') continue;
    let depth = 0;
    let end = at + needle.length - 1;
    for (; end < code.length; end += 1) {
      if (code[end] === '(') depth += 1;
      else if (code[end] === ')') { depth -= 1; if (depth === 0) break; }
    }
    calls.push(code.slice(at + needle.length, end).trim());
  }
  assert.ok(calls.length >= 5, `every call site is accounted for (${calls.length})`);
  for (const args of calls) {
    assert.ok(args.includes(','), `a call site states whether Auto helps: publicCreditGateResponse(${args})`);
  }

  /*
   * The conversation paths say no, unconditionally — both the chat endpoint
   * and the generate route's conversation branch.
   */
  assert.match(server, /selectedModel !== 'auto' && decision\.intent !== 'conversation',/,
    'the chat endpoint requires a picked model AND a model-priced intent');
  assert.match(server, /const autoCanHelp = requestedModelSelection !== 'auto' && decision\.intent !== 'conversation';/,
    'and so does the generate route conversation branch');

  /*
   * `requestedModelSelection`, not `effectiveModelSelection`.
   *
   * The latter is what the router resolved to and is typed as a concrete model
   * id — it is never the string 'auto'. Testing it would have compiled to a
   * constant false and silently switched the advice off on the one branch
   * where it is genuine. The compiler caught it; this keeps it caught.
   */
  assert.doesNotMatch(server, /autoCanHelp = effectiveModelSelection/,
    'the resolved model is never compared to a selection sentinel');
  assert.match(server, /const autoCanHelp = requestedModelSelection !== 'auto';/,
    'the build branch reads what the customer asked for');
}

console.log('credit gate advice tests passed');
