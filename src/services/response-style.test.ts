import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REFERENCE_REPLIES } from './response-reference';
import { buildAgentTextSystemPrompt, buildFinalizerSystemPrompt } from './agent-prompt-stack';
import { summarizePipelineOutcome } from './multi-agent-pipeline';
import {
  claimsVerification, detectUserLevel, gradeResponse, hasVerificationEvidence, humanizeText, RESPONSE_STYLE_GUIDE, responseStyleEnabled, styleBlock, withHonestyNote,
} from './response-style';

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

describe('the rubric', () => {
  it('tells the two kinds of answer apart on every reference conversation', () => {
    for (const reply of REFERENCE_REPLIES) {
      const before = gradeResponse({ text: reply.before, prompt: reply.prompt, evidence: reply.evidence, kind: reply.kind });
      const after = gradeResponse({ text: reply.after, prompt: reply.prompt, evidence: reply.evidence, kind: reply.kind });
      expect(after.total, reply.id).toBeGreaterThan(before.total);
      expect(after.total, reply.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the mean score rises by about a point, and honesty most of all', () => {
    const grade = (pick: 'before' | 'after') => REFERENCE_REPLIES.map(reply => gradeResponse({ text: reply[pick], prompt: reply.prompt, evidence: reply.evidence, kind: reply.kind }));
    const before = grade('before');
    const after = grade('after');
    // What the rubric can see, on reconstructed replies: a real improvement, not a doubled score.
    expect(mean(after.map(score => score.total)) - mean(before.map(score => score.total))).toBeGreaterThan(0.9);
    expect(mean(after.map(score => score.honesty))).toBeGreaterThan(mean(before.map(score => score.honesty)) + 1);
    expect(mean(after.map(score => score.concision))).toBeGreaterThan(mean(before.map(score => score.concision)));
    expect(mean(after.map(score => score.fidelity))).toBeGreaterThanOrEqual(mean(before.map(score => score.fidelity)));
  });

  it('does not read « je n\'ai pas pu vérifier » as a claim to have verified', () => {
    expect(claimsVerification('Je n’ai pas pu la vérifier dans l’aperçu.')).toEqual([]);
    expect(claimsVerification('I have not checked it in the preview yet.')).toEqual([]);
    expect(claimsVerification('Rien n’a été testé pour le moment, sans erreur connue.').length).toBe(0);
    expect(claimsVerification('Tout est testé et fonctionne parfaitement.').length).toBeGreaterThan(0);
    expect(withHonestyNote('Je n’ai pas pu la vérifier dans l’aperçu.', {}, true)).toBe('Je n’ai pas pu la vérifier dans l’aperçu.');
  });

  it('does not punish an answer for saying it verified something that was verified', () => {
    const score = gradeResponse({ text: 'La page est ajoutée. Vérifié dans l’aperçu : le formulaire s’envoie.', prompt: 'Ajoute une page de contact.', evidence: { journeys: 2, viewports: 3, previewLooked: true }, kind: 'recap' });
    expect(score.honesty).toBe(5);
  });
});

describe('the guards on what reaches the person', () => {
  it('improve the old-style answers on their own, before any model follows the guide', () => {
    const guarded = (reply: (typeof REFERENCE_REPLIES)[number]) => withHonestyNote(humanizeText(reply.before, { french: /[éèàç]|\b(?:je|le|la|un|une)\b/i.test(reply.prompt), userMessages: [reply.prompt] }), reply.evidence, /[éèàç]|\b(?:je|le|la|un|une|des|fais|ajoute)\b/i.test(reply.prompt));
    const raw = mean(REFERENCE_REPLIES.map(reply => gradeResponse({ text: reply.before, prompt: reply.prompt, evidence: reply.evidence, kind: reply.kind }).total));
    const after = mean(REFERENCE_REPLIES.map(reply => gradeResponse({ text: guarded(reply), prompt: reply.prompt, evidence: reply.evidence, kind: reply.kind }).total));
    expect(after).toBeGreaterThan(raw);
  });

  it('turn tool names, identifiers and generated paths into words a person uses', () => {
    const text = 'J’ai utilisé write_file sur src/components/ProductGrid.tsx (run-8f3a9c21d4) puis run_command.';
    const plain = humanizeText(text, { french: true });
    expect(plain).not.toMatch(/write_file|run_command|run-8f3a9c21d4|ProductGrid/);
    expect(plain).toMatch(/a créé un fichier/);
    expect(plain).toMatch(/un fichier/);
    expect(humanizeText('Fichier src/App.tsx modifié.', { french: true, userMessages: ['Change src/App.tsx'] })).toContain('src/App.tsx');
    expect(humanizeText('wrote write_file', { french: false })).toMatch(/created a file/);
  });

  it('add one honest sentence when « testé » is claimed and nothing was tested — and never remove what was written', () => {
    const claim = 'Tout est testé et fonctionne parfaitement.';
    expect(claimsVerification(claim).length).toBeGreaterThan(0);
    const fixed = withHonestyNote(claim, { built: true }, true);
    expect(fixed.startsWith(claim)).toBe(true);
    expect(fixed).toMatch(/n’a pas été faite dans l’aperçu/);
    expect(withHonestyNote(claim, { journeys: 2, viewports: 3 }, true)).toBe(claim);
    expect(withHonestyNote('La page est ajoutée.', undefined, true)).toBe('La page est ajoutée.');
    expect(withHonestyNote('Everything works perfectly.', {}, false)).toMatch(/Coden did not check this in the preview/);
    expect(hasVerificationEvidence({ previewLooked: true })).toBe(true);
    expect(hasVerificationEvidence({ built: true })).toBe(false);
  });

  it('are applied to the run\'s recap, where the planner\'s own sentence used to go out as written', () => {
    const base = { ok: true, route: 'new_project' as const, diff: { created: ['a'], modified: [], deleted: [] }, stoppedBecause: 'no_errors' as any, prompt: 'Fais-moi une boutique.' };
    const unverified = summarizePipelineOutcome({ ...base, plan: { summary: 'Boutique créée, testée et fonctionne parfaitement.', files: [] } as any });
    expect(unverified).toMatch(/n’a pas été faite dans l’aperçu/);
    const verified = summarizePipelineOutcome({ ...base, plan: { summary: 'Boutique créée, testée.', files: [] } as any, evidence: { scenarios: [{ ok: true }, { ok: true }], responsiveViewports: [390, 768, 1280] } as any });
    expect(verified).not.toMatch(/n’a pas été faite dans l’aperçu/);
    expect(verified).toMatch(/2\/2 parcours/);
  });
});

describe('the guide', () => {
  it('is short, and says the five things people notice', () => {
    expect(RESPONSE_STYLE_GUIDE.length).toBeLessThan(2_200);
    for (const part of [/short, structured/i, /Honest/, /Plain progress/, /Faithful to the request/, /Errors:/, /language of the person/]) expect(RESPONSE_STYLE_GUIDE).toMatch(part);
    expect(RESPONSE_STYLE_GUIDE).toMatch(/same for every model/);
  });

  it('reads the person\'s level and adapts, without guessing when it cannot tell', () => {
    expect(detectUserLevel(['Je suis débutant, je ne sais pas coder.'])).toBe('beginner');
    expect(detectUserLevel(['Refactor the useEffect hook, the API endpoint returns a JWT and the SQL migration fails on Supabase.'])).toBe('developer');
    expect(detectUserLevel(['Fais-moi une boutique pour mes bougies.'])).toBe('unknown');
    expect(detectUserLevel([])).toBe('unknown');
    expect(styleBlock(['Je suis débutant'])).toMatch(/not a developer: no jargon at all/);
    expect(styleBlock(['Refactor the useEffect hook, the API endpoint returns a JWT and the SQL migration fails.'])).toMatch(/writes code/);
    expect(styleBlock([])).toMatch(/smart person who is not a developer/);
  });

  it('is switched off by CODEN_RESPONSE_STYLE=0 and adds nothing then', () => {
    expect(responseStyleEnabled({})).toBe(true);
    expect(responseStyleEnabled({ CODEN_RESPONSE_STYLE: '0' })).toBe(false);
    expect(styleBlock(['x'], { CODEN_RESPONSE_STYLE: '0' })).toBe('');
  });

  it('reaches every kind of answer: chat, the closing recap, and the coder that talks while it works', () => {
    const chat = buildAgentTextSystemPrompt({ intent: 'conversation', modeInstruction: 'x', languageInstruction: 'y', styleBlock: 'STYLE-BLOCK' });
    const recap = buildFinalizerSystemPrompt({ modeInstruction: 'x', languageInstruction: 'y', styleBlock: 'STYLE-BLOCK' });
    expect(chat).toContain('STYLE-BLOCK');
    expect(recap).toContain('STYLE-BLOCK');
    expect(buildAgentTextSystemPrompt({ intent: 'conversation', modeInstruction: 'x', languageInstruction: 'y' })).not.toContain('STYLE-BLOCK');
    const pipeline = readFileSync('src/services/multi-agent-pipeline.ts', 'utf8');
    expect(pipeline).toMatch(/styleBlock\(input\.userMessages\)/);
    const server = readFileSync('server.ts', 'utf8');
    expect(server).toMatch(/styleBlock: styleGuide/);
    expect(server).toMatch(/userMessages: \[\.\.\.recentHistory\.filter/);
  });
});
