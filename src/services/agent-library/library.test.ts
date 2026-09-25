import { describe, expect, it } from 'vitest';
import { LocalHashEmbedder } from '../embeddings';
import { findEquivalent, libraryRejection, normalizeAgentDefinition, normalizeSkillDefinition, rankLibrary, renderSkills, sanitizeForLibrary, shouldAutoDisable, slugify, successRate, type LibraryItem } from './library';

/* Built in pieces: a test value, not a key, and secret scanners need not see one. */
const FAKE_STRIPE_KEY = ['sk', 'live', '51Habcdefghijklmnopqrstuvwxyz0123456789'].join('_');

const embedder = new LocalHashEmbedder(256);
const vector = async (text: string) => (await embedder.embed([text]))[0];

function item(patch: Partial<LibraryItem>): LibraryItem {
  return {
    id: 'id', kind: 'skill', slug: 'x', name: 'x', description: '', version: 1, status: 'active', is_latest: true, parent_id: null,
    definition: { whenToUse: '', instructions: '', examples: [], dependencies: [] }, tags: [], embedding: null, uses: 0, successes: 0, failures: 0,
    contributors: [], created_by: 'agent', disabled_reason: null, last_used_at: null, created_at: '', updated_at: '', ...patch,
  };
}

describe('agent library rules', () => {
  it('strips secrets, people and private links, keeps code and public docs', () => {
    const text = [
      `const stripe = new Stripe("${FAKE_STRIPE_KEY}");`,
      'Contact: awa.kone@boutique-awa.ci, +225 07 07 07 07 07',
      'const url = "https://xyzabcdefghijklmnopq.supabase.co";',
      'Voir https://stripe.com/docs/payments et https://admin.boutique-awa.ci/secret',
      "const id = '3f2b1c4d-1111-4222-8333-444455556666';",
      'for (let i = 0; i < 10; i += 1) total += price[i];',
    ].join('\n');
    const clean = sanitizeForLibrary(text, 5_000);
    expect(clean).not.toContain('sk_live');
    expect(clean).not.toContain('awa.kone');
    expect(clean).not.toContain('+225');
    expect(clean).toContain('<project>.supabase.co');
    expect(clean).toContain('https://stripe.com/docs/payments');
    expect(clean).not.toContain('boutique-awa.ci/secret');
    expect(clean).toContain('00000000-0000-0000-0000-000000000000');
    expect(clean).toContain('for (let i = 0; i < 10; i += 1) total += price[i];');
  });

  it('normalises definitions and refuses what is not reusable', () => {
    expect(slugify('Intégrer Stripe (Checkout)')).toBe('integrer-stripe-checkout');
    const skill = normalizeSkillDefinition({ whenToUse: 'Paiement', instructions: 'court', examples: [{ title: 't', code: 'x()' }, { title: 'vide', code: '' }], dependencies: ['@stripe/stripe-js@^4', 'rm -rf /', 'stripe'] });
    expect(skill.examples).toHaveLength(1);
    expect(skill.dependencies).toEqual(['@stripe/stripe-js@^4', 'stripe']);
    expect(libraryRejection('skill', 'Stripe', skill)).toMatch(/trop courtes/);
    const agent = normalizeAgentDefinition({ role: 'Expert UI', systemPrompt: 'x'.repeat(120), tools: ['write_file', 'rm', 'read_file'], modelTier: 'nope' as any }, ['read_file', 'write_file']);
    expect(agent).toMatchObject({ tools: ['write_file', 'read_file'], modelTier: 'balanced' });
    expect(libraryRejection('agent', 'Expert UI', agent)).toBeNull();
  });

  it('ranks by meaning and measured success, and switches off what keeps failing', async () => {
    const stripe = item({ id: 's', name: 'Intégrer Stripe', description: 'paiement carte checkout abonnement stripe', embedding: await vector('Intégrer Stripe paiement carte checkout abonnement stripe'), uses: 10, successes: 9 });
    const auth = item({ id: 'a', name: 'Auth Supabase', description: 'connexion inscription supabase auth', embedding: await vector('Auth Supabase connexion inscription supabase auth') });
    const off = item({ id: 'o', name: 'Stripe ancien', status: 'disabled', embedding: await vector('Stripe paiement') });
    const ranked = rankLibrary([stripe, auth, off], await vector('ajouter le paiement stripe checkout'), { kind: 'skill', limit: 3 });
    expect(ranked[0].item.id).toBe('s');
    expect(ranked.some(entry => entry.item.id === 'o')).toBe(false);
    expect(successRate({ uses: 0, successes: 0 })).toBe(0.5);
    expect(shouldAutoDisable({ uses: 7, successes: 1, created_by: 'agent' })).toBe(true);
    expect(shouldAutoDisable({ uses: 7, successes: 5, created_by: 'agent' })).toBe(false);
    expect(shouldAutoDisable({ uses: 9, successes: 0, created_by: 'admin' })).toBe(false);
  });

  it('recognises the same method by slug or by meaning', async () => {
    const existing = item({ id: 'e', slug: 'integrer-stripe', embedding: await vector('Intégrer Stripe paiement checkout') });
    expect(findEquivalent([existing], { kind: 'skill', slug: 'integrer-stripe', embedding: null })?.id).toBe('e');
    expect(findEquivalent([existing], { kind: 'skill', slug: 'stripe-checkout', embedding: await vector('Intégrer Stripe paiement checkout') })?.id).toBe('e');
    expect(findEquivalent([existing], { kind: 'skill', slug: 'auth', embedding: await vector('connexion utilisateur supabase') })).toBeNull();
  });

  it('shows skills with their known pitfalls', () => {
    const text = renderSkills([{ item: item({ id: 'k', name: 'Auth Supabase', version: 2, uses: 4, successes: 3, definition: { whenToUse: 'Connexion', instructions: 'Étapes', examples: [{ title: 'Client', language: 'ts', code: 'createClient()' }], dependencies: ['@supabase/supabase-js'] } }), pitfalls: ['Avec supabase-js v2 : utiliser getSession()'] }]);
    expect(text).toContain('### Auth Supabase (v2, réussite 67 %, id k)');
    expect(text).toContain('```ts\ncreateClient()\n```');
    expect(text).toContain('Pièges connus :\n- Avec supabase-js v2');
  });
});
