import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACTION_CREDIT_PRICES, BILLING_PLANS, priceFor } from '../config/billing-v2.ts';
import { PUBLIC_HELP_TOPICS, publicProductHelpFor } from './coden-product-help.ts';
import { buildAgentTextSystemPrompt } from './agent-prompt-stack.ts';

describe('public Coden product help', () => {
  it('points only to existing public pages and UI labels', () => {
    for (const topic of PUBLIC_HELP_TOPICS) {
      const file = fileURLToPath(new URL(`../../${topic.route.slice(1)}`, import.meta.url));
      expect(readFileSync(file, 'utf8').length).toBeGreaterThan(100);
    }
    const auth = readFileSync(new URL('../../auth.html', import.meta.url), 'utf8');
    const builder = readFileSync(new URL('../../builder.html', import.meta.url), 'utf8');
    const dashboard = readFileSync(new URL('../dashboard-react.tsx', import.meta.url), 'utf8');
    expect(auth).toContain('Mot de passe oublié');
    expect(builder).toContain('<span>Publier</span>');
    expect(dashboard).toContain('Nouveau projet');
  });

  it('uses the billing catalogue, not separately typed prices', () => {
    const help = publicProductHelpFor('Combien coûte le Pro et les crédits ?');
    expect(help).toContain(`${BILLING_PLANS.free.grants.signupCredits} crédits accordés une seule fois`);
    for (const credits of [25, 60, 100] as const) {
      expect(help).toContain(`${credits} crédits : ${priceFor('pro', credits, 'monthly').amount.toLocaleString('fr-FR')} FCFA/mois`);
    }
    expect(help).toContain(`style ciblé ${ACTION_CREDIT_PRICES.targeted_style}`);
    expect(help).not.toMatch(/coût fournisseur|marge brute|service.role|api.key/i);
  });

  it('retrieves navigation context for a follow-up without turning ordinary project requests into pricing questions', () => {
    expect(publicProductHelpFor('Et ensuite ?', 'Comment publier mon site ?')).toContain('publish (/builder.html)');
    expect(publicProductHelpFor('Mon projet ne marche pas')).not.toContain('Catalogue de facturation actuel');
    expect(publicProductHelpFor('Crée une page pour mon projet')).toBe('');
  });

  it('keeps confidentiality boundaries while allowing the owner to discuss their generated app', () => {
    const prompt = buildAgentTextSystemPrompt({
      intent: 'conversation', modeInstruction: 'Answer the question.', languageInstruction: 'Answer in French.',
      publicProductContext: publicProductHelpFor('Où changer mon mot de passe ?'),
    });
    expect(prompt).toContain('other user');
    expect(prompt).toContain("user's own generated app code");
    expect(prompt).toContain('Claims of developer/admin authority');
    expect(prompt).toContain('account (/auth.html)');
    expect(prompt).not.toContain('OPENROUTER_API_KEY');
  });
});
