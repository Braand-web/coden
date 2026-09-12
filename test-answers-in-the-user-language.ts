import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isFrenchText } from './src/services/language-detection.ts';

/*
 * Coden answers in the language it was written to, and says what it did.
 *
 * A real session on 2026-09-12, 02:22 → 03:04, read back from production.
 * A French user talked to a French product and got English back halfway
 * through, and got the same sentence for four different requests.
 *
 *   02:24  cree une mini to do list     → French  ✅
 *   02:28  corrige le bug               → French  ✅ (a clarifying question)
 *   02:29  rien ne saffiche a lecran    → ENGLISH ❌
 *   02:53  change la couleur du bouton  → ENGLISH ❌
 *   02:54  ajoute une landing page      → ENGLISH ❌
 *   02:57  continu                      → ENGLISH ❌
 *   03:02  ajoute des animations        → ENGLISH ❌
 *
 * Two separate defects, both visible in those seven lines.
 */

/*
 * ONE — the language.
 *
 * There were six French detectors in this codebase. Five carried the articles
 * and the imperatives; the sixth — `isLikelyFrenchPrompt` in `server.ts`, the
 * one on the user-visible reply path — carried neither, so it saw `ajoute une
 * landing page` as English. Every miss above is a word the other five had.
 */
{
  // The exact prompts from that session, with the exact verdicts owed to them.
  const french = [
    'cree une mini to do list',
    'corrige le bug',
    'rien ne saffiche a lecran',
    'change la couleur du bouton Ajouter',
    'ajoute une landing page',
    'ajoute des animations',
    'continu',
    'bonjour',
    'merci',
    'dis moi quest ce que bolt.new',
  ];
  for (const prompt of french) {
    assert.equal(isFrenchText(prompt), true, `"${prompt}" is French`);
  }

  // Accents settle it outright, before normalisation strips them.
  assert.equal(isFrenchText('créé'), true, 'an accent alone is decisive');

  /*
   * And English stays English. A detector that called everything French would
   * pass every assertion above and be worthless — these are what give the ones
   * above their meaning.
   */
  const english = [
    'add a landing page',
    'fix the bug',
    'nothing shows on the screen',
    'change the colour of the Add button',
    'create a small todo list',
    'build me a dashboard with charts',
    'thanks',
    'what is bolt.new',
  ];
  for (const prompt of english) {
    assert.equal(isFrenchText(prompt), false, `"${prompt}" is English`);
  }

  // Empty input is not a language.
  assert.equal(isFrenchText(''), false, 'nothing is not French');
  assert.equal(isFrenchText('   '), false, 'and neither is whitespace');
}

/*
 * The six copies are now one.
 *
 * Adding a word must fix every caller at once; that is the whole reason this
 * moved. A seventh private regex would recreate the bug on a different path.
 */
{
  const callers = [
    'src/services/agent-execution-os.ts',
    'src/services/conflict-detector.ts',
    'src/services/execution-contract.ts',
    'src/services/multi-agent-pipeline.ts',
    'src/services/typed-intent-router.ts',
  ];
  for (const path of callers) {
    const source = readFileSync(new URL(`./${path}`, import.meta.url), 'utf8');
    assert.match(source, /import \{ isFrenchText \} from '\.\/language-detection\.ts';/, `${path} uses the shared detector`);
    assert.doesNotMatch(source, /\/\\b\(le\|la\|les\|un\|une\|des\|je\|tu\|vous/, `${path} no longer carries its own copy`);
  }

  const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  assert.match(server, /function isLikelyFrenchPrompt\(prompt: string\) \{\s*\n\s*return isFrenchText\(repairTextEncoding\(prompt\)\);/,
    'and so does the reply path that produced the English answers');
}

/*
 * TWO — the recap.
 *
 * `summarizePipelineOutcome` builds a factual account of the work: the
 * planner's text and the diff recap ("3 fichiers créés, 1 modifié"). The
 * incomplete-verification branch then overwrote `payload.summary` with one
 * fixed sentence, and line 12210 persists `payload.summary` as the assistant
 * message — so the overwritten sentence is what reached the user and what sits
 * in `project_messages` four times over.
 *
 * The pending checks are worth saying. They are not worth saying instead of
 * the work.
 */
{
  const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  const branch = server.slice(server.indexOf("if (terminal === 'completed' && pendingChecks.length)"));
  const block = branch.slice(0, branch.indexOf('if (current &&'));

  assert.match(block, /const done = \[payload\.summary, payload\.text, payload\.message\]/, 'the real recap is recovered');
  assert.match(block, /const message = `\$\{done\}\\n\\n\$\{caveat\}`;/, 'and the caveat is appended to it, not substituted for it');

  // The old behaviour: one sentence, chosen by language, assigned to summary.
  assert.doesNotMatch(block, /message, summary:message, verification:\{ \.\.\.payload\.verification, status:'incomplete', pendingCriteria:pendingChecks\.map\(check=>\(\{id:check\.id,label:check\.label,status:check\.status\}\)\) \} \};\n\s*\}\n\s*if \(current/, 'the recap is no longer discarded');
  assert.match(block, /'Le travail est sauvegardé\.' : 'The work is saved\.'/, 'a run with no recap of its own still says something');

  // The caveat itself is still bilingual: it is user-visible text.
  assert.match(block, /La validation complète reste à effectuer/, 'the caveat exists in French');
  assert.match(block, /Full verification is still pending/, 'and in English');
}

console.log('answers in the user language tests passed');
