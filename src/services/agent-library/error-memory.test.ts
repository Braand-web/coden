import { describe, expect, it } from 'vitest';
import { applicability, librariesFromPackageJson, libraryInMessage, memorySignature, observe, rankMemories, renderErrorRules, sanitizeObservation, type ErrorMemory } from './error-memory';

/* Built in pieces: a test value, not a key, and secret scanners need not see one. */
const FAKE_STRIPE_KEY = ['sk', 'live', '51Habcdefghijklmnopqrstuvwxyz0123456789'].join('_');

function memory(patch: Partial<ErrorMemory>): ErrorMemory {
  return {
    id: 'm', signature: 's', category: 'build', error_message: 'err', context: {}, cause: '', fix: '', rule: 'règle', status: 'active', permanent: false,
    occurrences: 1, confirmations: 1, recurrences_after_rule: 0, skill_id: null, contributors: [], embedding: null, edited_by_admin: false,
    last_seen_at: '', last_recurrence_at: null, created_at: '', updated_at: '', ...patch,
  };
}

describe('error memory', () => {
  it('groups the same error seen in different files and lines', () => {
    const a = memorySignature({ category: 'build', message: "src/pages/Home.tsx(12,4): error TS2305: Module 'react-router-dom' has no exported member 'Switch'.", library: 'react-router-dom' });
    const b = memorySignature({ category: 'build', message: "src/App.tsx(88,10): error TS2305: Module 'react-router-dom' has no exported member 'Switch'.", library: 'react-router-dom' });
    expect(a).toBe(b);
    expect(memorySignature({ category: 'runtime', message: 'x is undefined' })).not.toBe(memorySignature({ category: 'build', message: 'x is undefined' }));
  });

  it('reads the stack of a project', () => {
    const libs = librariesFromPackageJson(JSON.stringify({ dependencies: { react: '^19.1.0', '@supabase/supabase-js': '~2.40.0' }, devDependencies: { vite: '6.0.0', local: 'file:../x' } }));
    expect(libs).toEqual({ react: 19, '@supabase/supabase-js': 2, vite: 6 });
    expect(libraryInMessage("Cannot find module '@supabase/supabase-js'", libs)).toBe('@supabase/supabase-js');
    expect(librariesFromPackageJson('not json')).toEqual({});
  });

  it('keeps only the generic, anonymised lesson', () => {
    const clean = sanitizeObservation({ category: 'runtime', message: 'Fetch to https://api.boutique-awa.ci/orders failed for awa@boutique.ci', library: 'react', libraries: { react: 19, lodash: 4 }, cause: `clé ${FAKE_STRIPE_KEY} dans le client`, fix: 'appeler le serveur', rule: 'ne jamais mettre la clé côté client' });
    expect(clean.message).not.toContain('boutique-awa');
    expect(clean.message).not.toContain('awa@');
    expect(clean.cause).not.toContain('sk_live');
    expect(clean.libraries).toEqual({ react: 19 });
  });

  it('applies a rule only to its stack, and re-checks it on another major version', () => {
    const rule = memory({ context: { libraries: { 'react-router-dom': 6 } } });
    expect(applicability(rule, { 'react-router-dom': 6 })).toBe('apply');
    expect(applicability(rule, { 'react-router-dom': 7 })).toBe('review');
    expect(applicability(rule, { vue: 3 })).toBe('skip');
    expect(applicability(rule, {})).toBe('apply');
    expect(applicability(memory({ status: 'candidate' }), {})).toBe('skip');
    expect(applicability(memory({ status: 'needs_review' }), {})).toBe('review');
  });

  it('puts permanent rules for the stack first and marks what to re-check', () => {
    const ranked = rankMemories([
      memory({ id: 'loose', rule: 'générale', embedding: null }),
      memory({ id: 'perm', permanent: true, rule: 'Ne pas importer Switch', context: { libraries: { 'react-router-dom': 7 } } }),
      memory({ id: 'old', rule: 'Ancienne API', context: { libraries: { '@supabase/supabase-js': 1 } } }),
    ], null, { 'react-router-dom': 7, '@supabase/supabase-js': 2 });
    expect(ranked.map(entry => entry.memory.id)).toEqual(['perm', 'old']);
    const text = renderErrorRules(ranked);
    expect(text).toContain('[IMPORTANT] Avec react-router-dom v7 : Ne pas importer Switch');
    expect(text).toContain('[À REVÉRIFIER — version différente] Avec @supabase/supabase-js v1');
  });

  it('counts recurrences despite the rule, confirms, and makes frequent errors permanent', () => {
    const now = new Date().toISOString();
    const seen = observe(memory({ status: 'candidate', occurrences: 2, confirmations: 1 }), { confirmed: true, ruleWasGiven: false, libraries: {}, contributor: 'c1', now });
    expect(seen).toMatchObject({ occurrences: 3, confirmations: 2, status: 'active', permanent: true, contributors: ['c1'] });
    const recurring = observe(memory({ recurrences_after_rule: 1 }), { confirmed: true, ruleWasGiven: true, libraries: {}, contributor: null, now });
    expect(recurring).toMatchObject({ recurrences_after_rule: 2, permanent: true, last_recurrence_at: now });
    const moved = observe(memory({ context: { libraries: { vite: 5 } } }), { confirmed: true, ruleWasGiven: false, libraries: { vite: 6 }, contributor: null, now });
    expect(moved.status).toBe('needs_review');
  });
});
