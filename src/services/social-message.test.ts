import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifySocialMessage, lastTurnAsksOrOffers, routerGuardEnabled } from './social-message';
import { buildIntentRouterSystemPrompt } from './agent-prompt-stack';

const built = [{ role: 'user', content: 'cree un site pour mon cabinet' }, { role: 'assistant', content: 'Terminé : la page est créée. Elle contient trois sections.' }];
const proposal = [{ role: 'user', content: 'cree un site' }, { role: 'assistant', content: 'Je te propose une page avec trois sections. Je lance ?' }];
const working = [{ role: 'user', content: 'oui' }, { role: 'assistant', content: 'Je lis l’écran et ses styles, puis je lancerai les vérifications.' }];

describe('a greeting, a thanks, a compliment: never an order', () => {
  it('a greeting is a greeting whatever the conversation, even with a plan or a proposal pending', () => {
    for (const prompt of ['bonjour', 'Bonjour !', 'salut', 'Hello', 'hey', 'bonsoir', 'coucou', 'Bonjour Coden', 'good morning']) {
      for (const history of [undefined, built, proposal, working]) expect(classifySocialMessage(prompt, history), prompt).toBe('greeting');
    }
  });

  it('a compliment or a thanks is conversation, unless Coden had just asked or offered something', () => {
    for (const prompt of ['parfait', 'Parfait !', 'merci', 'Merci beaucoup', 'super', 'top', 'génial', 'nickel', 'bravo', 'cool']) {
      expect(classifySocialMessage(prompt, built), prompt).toBe('acknowledgement');
      expect(classifySocialMessage(prompt, working), prompt).toBe('acknowledgement');
      expect(classifySocialMessage(prompt), prompt).toBe('acknowledgement');
      expect(classifySocialMessage(prompt, proposal), prompt).toBeNull();
    }
  });

  it('an answer to a proposal, a request with a greeting in it, and a long message are left to the model', () => {
    for (const prompt of ['oui', 'ok', 'vas-y', 'fais-le', 'continue', 'bonjour, cree moi une calculatrice', 'salut, peux-tu changer la couleur du bouton en vert', 'cree une app', '']) expect(classifySocialMessage(prompt, proposal), prompt).toBeNull();
  });

  it('knows when the last turn asks or offers', () => {
    expect(lastTurnAsksOrOffers(proposal)).toBe(true);
    expect(lastTurnAsksOrOffers([{ role: 'assistant', content: 'Veux-tu que j’ajoute un mode sombre ?' }])).toBe(true);
    expect(lastTurnAsksOrOffers([{ role: 'assistant', content: 'Shall I add a pricing page' }])).toBe(true);
    expect(lastTurnAsksOrOffers(built)).toBe(false);
    expect(lastTurnAsksOrOffers(working)).toBe(false);
    expect(lastTurnAsksOrOffers(undefined)).toBe(false);
  });

  it('can be switched off', () => {
    expect(routerGuardEnabled({})).toBe(true);
    expect(routerGuardEnabled({ CODEN_ROUTER_GUARD: '0' })).toBe(false);
  });

  it('is applied before the model router, and the router is told the same thing', () => {
    const server = readFileSync('server.ts', 'utf8');
    const guard = server.indexOf('classifySocialMessage(input.prompt, input.recentHistory)');
    const router = server.indexOf('const modelDecision = await classifyIntentWithAi(input, fallback);');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(router);
    expect(buildIntentRouterSystemPrompt()).toMatch(/A greeting .* is conversation — never a go-ahead/);
  });
});
