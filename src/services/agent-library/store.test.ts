import { describe, expect, it } from 'vitest';
import { LocalHashEmbedder } from '../embeddings';
import { fakeSupabase } from './fake-supabase.test-helper';
import { AgentLibraryStore, openLibrarySession } from './store';
import type { SkillDefinition } from './library';

const skill = (instructions: string, dependencies: string[] = ['@stripe/stripe-js']): SkillDefinition => ({
  whenToUse: 'Quand une application doit encaisser un paiement par carte',
  instructions,
  examples: [{ title: 'Checkout', language: 'ts', code: 'await stripe.redirectToCheckout({ sessionId })' }],
  dependencies,
});
const LONG = 'Créer la session de paiement côté serveur, jamais côté client. Stocker la clé secrète dans une variable d’environnement. Vérifier la signature du webhook avant de valider la commande. Rediriger vers Checkout puis confirmer au retour.';

function setup() {
  const db = fakeSupabase();
  const store = new AgentLibraryStore(db, new LocalHashEmbedder(256));
  const session = (share = true, contributor = 'c1') => openLibrarySession({ requestId: `req-${Math.random()}`, contributor, shareAllowed: share, projectLibraries: { react: 19, '@supabase/supabase-js': 2 } });
  return { db, store, session };
}

describe('library store', () => {
  it('promotes what a successful run created, and nothing from a failed or private one', async () => {
    const { db, store, session } = setup();
    const failed = session();
    failed.candidates.push({ kind: 'skill', name: 'Intégrer Stripe', description: 'Paiement par carte', definition: skill(LONG), tags: [] });
    await store.settle(failed, { success: false, cancelled: false });
    const privateRun = session(false);
    privateRun.candidates.push({ kind: 'skill', name: 'Intégrer Stripe', description: 'Paiement par carte', definition: skill(LONG), tags: [] });
    await store.settle(privateRun, { success: true, cancelled: false });
    expect(db.tables.agent_library_items).toHaveLength(0);

    const ok = session();
    ok.candidates.push({ kind: 'skill', name: 'Intégrer Stripe', description: 'Paiement par carte', definition: skill(LONG), tags: [] });
    ok.candidates.push({ kind: 'agent', name: 'Expert UI', description: 'Écrans', definition: { role: 'Expert UI', systemPrompt: 'x'.repeat(120), tools: ['write_file'], modelTier: 'design' }, tags: [], succeeded: false });
    const report = await store.settle(ok, { success: true, cancelled: false });
    expect(report.promoted).toBe(1);
    expect(db.tables.agent_library_items).toHaveLength(1);
    expect(db.tables.agent_library_items[0]).toMatchObject({ kind: 'skill', slug: 'integrer-stripe', status: 'active', version: 1, contributors: ['c1'] });
  });

  it('merges a duplicate, versions an improvement and keeps the old version', async () => {
    const { db, store, session } = setup();
    const first = session();
    first.candidates.push({ kind: 'skill', name: 'Intégrer Stripe', description: 'Paiement par carte', definition: skill(LONG), tags: [] });
    await store.settle(first, { success: true, cancelled: false });

    const again = session(true, 'c2');
    again.candidates.push({ kind: 'skill', name: 'Intégrer Stripe', description: 'Paiement', definition: skill(LONG.slice(0, 150)), tags: [] });
    expect((await store.settle(again, { success: true, cancelled: false })).merged).toBe(1);
    expect(db.tables.agent_library_items).toHaveLength(1);
    expect(db.tables.agent_library_items[0].contributors).toEqual(['c1', 'c2']);

    const better = session();
    const original = db.tables.agent_library_items[0];
    better.candidates.push({ kind: 'skill', name: 'Intégrer Stripe', description: 'Paiement par carte et abonnements', definition: skill(`${LONG} Gérer aussi les abonnements et les remboursements.`), tags: [], improves: original.id });
    expect((await store.settle(better, { success: true, cancelled: false })).versions).toBe(1);
    const rows = db.tables.agent_library_items.sort((a, b) => a.version - b.version);
    expect(rows.map(row => [row.version, row.status, row.is_latest])).toEqual([[1, 'archived', false], [2, 'active', true]]);
    expect(rows[1].parent_id).toBe(original.id);
  });

  it('finds the right skill for a task and counts its use', async () => {
    const { db, store, session } = setup();
    const seed = session();
    seed.candidates.push({ kind: 'skill', name: 'Intégrer Stripe', description: 'Paiement par carte avec Stripe Checkout', definition: skill(LONG), tags: ['stripe'] });
    seed.candidates.push({ kind: 'skill', name: 'Auth Supabase', description: 'Connexion et inscription avec Supabase Auth', definition: skill(`${LONG.replace(/paiement|Checkout|commande/gi, 'connexion')} Utiliser supabase.auth.signInWithPassword.`, ['@supabase/supabase-js']), tags: ['supabase'] });
    await store.settle(seed, { success: true, cancelled: false });

    const run = session();
    const retrieval = await store.retrieve(run, 'Ajoute un paiement Stripe Checkout pour la boutique');
    expect(retrieval.skills[0]?.name).toBe('Intégrer Stripe');
    expect(retrieval.block).toContain('## Skills de la bibliothèque Coden');
    await store.settle(run, { success: true, cancelled: false });
    const stripe = db.tables.agent_library_items.find(row => row.name === 'Intégrer Stripe')!;
    expect(stripe).toMatchObject({ uses: 1, successes: 1 });
    expect(db.tables.agent_library_usage.at(-1)).toMatchObject({ item_id: stripe.id, outcome: 'success' });
  });

  it('switches off an item that keeps failing', async () => {
    const { db, store, session } = setup();
    db.tables.agent_library_items.push({ id: 'weak', kind: 'agent', slug: 'weak', name: 'Weak', description: '', version: 1, status: 'active', is_latest: true, definition: {}, tags: [], embedding: null, uses: 6, successes: 1, failures: 5, contributors: [], created_by: 'agent' });
    const run = session();
    run.usedItemIds.add('weak');
    run.itemOutcomes.set('weak', false);
    const report = await store.settle(run, { success: true, cancelled: false });
    expect(report.disabled).toBe(1);
    expect(db.tables.agent_library_items[0]).toMatchObject({ status: 'disabled', uses: 7, failures: 6 });
    expect(db.tables.agent_library_items[0].disabled_reason).toMatch(/1 réussite\(s\) sur 7/);
  });

  it('remembers confirmed errors, counts recurrences despite the rule and gives the rule to later runs', async () => {
    const { db, store, session } = setup();
    const first = session();
    first.errors.push({ category: 'build', message: "src/App.tsx(3,10): error TS2305: Module '@supabase/supabase-js' has no exported member 'SupabaseAuthClient'.", library: '@supabase/supabase-js', libraries: first.projectLibraries, cause: 'Type interne importé', fix: 'Importer SupabaseClient', rule: 'Avec supabase-js v2, importer SupabaseClient et non SupabaseAuthClient.' });
    await store.settle(first, { success: true, cancelled: false });
    expect(db.tables.agent_error_memory).toHaveLength(1);
    expect(db.tables.agent_error_memory[0]).toMatchObject({ status: 'active', occurrences: 1, confirmations: 1 });

    const later = session(true, 'c2');
    const retrieval = await store.retrieve(later, 'Crée une page de connexion avec supabase');
    expect(retrieval.block).toContain('## Règles apprises des erreurs déjà rencontrées');
    expect(retrieval.block).toContain('importer SupabaseClient');
    later.errors.push({ category: 'build', message: "src/pages/Login.tsx(8,2): error TS2305: Module '@supabase/supabase-js' has no exported member 'SupabaseAuthClient'.", library: '@supabase/supabase-js', libraries: later.projectLibraries });
    await store.settle(later, { success: true, cancelled: false });
    expect(db.tables.agent_error_memory).toHaveLength(1);
    expect(db.tables.agent_error_memory[0]).toMatchObject({ occurrences: 2, confirmations: 2, recurrences_after_rule: 1, contributors: ['c1', 'c2'] });
  });

  it('keeps an unconfirmed error as a candidate that is never given to agents', async () => {
    const { db, store, session } = setup();
    const run = session();
    run.errors.push({ category: 'runtime', message: 'window is not defined', libraries: {}, fix: 'Garder', rule: 'Ne pas lire window au rendu serveur.' });
    await store.settle(run, { success: false, cancelled: false });
    expect(db.tables.agent_error_memory[0].status).toBe('candidate');
    expect((await store.retrieve(session(), 'window is not defined au rendu')).rules).toHaveLength(0);
  });

  it('records a user correction only once restated generically', async () => {
    const { db, store, session } = setup();
    const run = session();
    run.errors.push({ category: 'user_correction', message: 'Le bouton Commander de la boutique de Mme Kouassi ne marche pas', libraries: {} });
    await store.settle(run, { success: true, cancelled: false }, async () => [{ message: 'Bouton d’action sans gestionnaire de clic', cause: 'onClick absent', fix: 'Brancher le gestionnaire', rule: 'Chaque bouton visible doit appeler une action réelle.' }]);
    expect(db.tables.agent_error_memory).toHaveLength(1);
    expect(db.tables.agent_error_memory[0].error_message).toBe('Bouton d’action sans gestionnaire de clic');
    expect(JSON.stringify(db.tables.agent_error_memory)).not.toContain('Kouassi');

    const noSummary = session();
    noSummary.errors.push({ category: 'user_correction', message: 'La page de Mme Kouassi est cassée', libraries: {} });
    await store.settle(noSummary, { success: true, cancelled: false });
    expect(db.tables.agent_error_memory).toHaveLength(1);
  });

  it('purges a user who stops sharing, keeping what others also contributed', async () => {
    const { db, store } = setup();
    db.tables.agent_library_items.push({ id: 'mine', contributors: ['c1'], created_by: 'agent' }, { id: 'shared', contributors: ['c1', 'c2'], created_by: 'agent' }, { id: 'curated', contributors: ['c1'], created_by: 'curated' });
    db.tables.agent_error_memory.push({ id: 'e1', contributors: ['c1'], created_by: undefined });
    const removed = await store.purgeContributor('c1');
    expect(removed).toBe(2);
    expect(db.tables.agent_library_items.map(row => [row.id, row.contributors])).toEqual([['shared', ['c2']], ['curated', []]]);
    expect(db.tables.agent_error_memory).toHaveLength(0);
  });
});
