import { describe, expect, it } from 'vitest';
import { STARTERS, STARTER_ENTRY_PLACEHOLDER } from '../sandbox/starters';
import { classifyCategory } from './categories';
import {
  contentFingerprint, decideVerdict, detectImpersonation, duplicateCheck, findPersonalData, hammingDistance, moderateText, privacyCheck,
  qualityCheck, qualityScore, republicationOutcome, scanSecrets, scanSuspiciousCode, securityCheck, technicalCheck, type PageSignals,
} from './checks';

const richPage: PageSignals = {
  reachable: true, textLength: 900, imageCount: 3, imagesWithoutAlt: 0, canvasCount: 0, consoleErrors: [], pageErrors: [], lang: 'fr', hasViewportMeta: true,
  hasMetaDescription: true, h1Count: 1, landmarkCount: 3, sectionCount: 5, cssVariableCount: 24, mediaQueryCount: 4, fontFamilyCount: 2,
  horizontalOverflowAtMobile: false, title: 'Atelier Lumière',
};

// A real Supabase anon key has role "anon"; a service key has role "service_role". Built here so no real key sits in the repo.
const jwt = (role: string) => `eyJ${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ iss: 'supabase', ref: 'abcdefghijklmnop', role })).toString('base64url')}.${'s'.repeat(30)}`;

describe('security: secrets in what the browser receives', () => {
  it('blocks a private key in front-end code, and never repeats the value', () => {
    const files = [{ path: 'src/lib/ai.ts', content: `const key = "sk-ant-${'a1B2'.repeat(8)}";` }];
    const result = securityCheck(files);
    expect(result).toMatchObject({ outcome: 'block', code: 'secret_in_browser_code' });
    expect(JSON.stringify(result)).not.toContain('a1B2a1B2');
  });

  it('does not confuse public keys with secrets: Supabase anon key, Stripe publishable key', () => {
    const files = [
      { path: 'src/lib/supabase.ts', content: `createClient('https://abcdefghijklmnop.supabase.co', '${jwt('anon')}')` },
      { path: 'src/pay.ts', content: `loadStripe('pk_live_${'x'.repeat(30)}')` },
      { path: '.env.example', content: 'VITE_SUPABASE_ANON_KEY=your_key_here' },
    ];
    expect(scanSecrets(files)).toEqual([]);
    expect(securityCheck(files).outcome).toBe('pass');
  });

  it('blocks a Supabase service-role key', () => {
    expect(scanSecrets([{ path: 'src/db.ts', content: `const k = '${jwt('service_role')}'` }])).toHaveLength(1);
  });

  it('ignores secrets in files the browser never gets (edge functions, migrations)', () => {
    expect(scanSecrets([{ path: 'supabase/functions/pay/index.ts', content: `const k = 'sk_live_${'z'.repeat(24)}'` }])).toEqual([]);
  });

  it('blocks masked, miner and redirect code', () => {
    expect(scanSuspiciousCode([{ path: 'src/a.js', content: 'eval(atob("ZG9pdA=="))' }])[0].code).toBe('obfuscated_eval');
    expect(scanSuspiciousCode([{ path: 'index.html', content: '<script src="https://coinhive.com/lib/x.js"></script>' }])[0].code).toBe('crypto_miner');
    expect(scanSuspiciousCode([{ path: 'index.html', content: '<meta http-equiv="refresh" content="0; url=https://evil.example/login">' }])[0].code).toBe('meta_refresh_external');
    expect(securityCheck([{ path: 'src/a.js', content: 'const x = 1;' }]).outcome).toBe('pass');
  });
});

describe('moderation: the cheap filter', () => {
  it('blocks the obvious, doubts the ambiguous, clears the rest', () => {
    expect(moderateText('Double your bitcoin in 24h, crypto giveaway').verdict).toBe('block');
    expect(moderateText('Contenu pour adultes 18+ réservé').verdict).toBe('doubt');
    expect(moderateText('Un site pour réserver une salle de sport').verdict).toBe('clear');
    expect(moderateText('Conseils crypto pour débutants').verdict).toBe('doubt');
  });

  it('flags a login page that wears a known brand, and spares a clone-for-learning', () => {
    expect(detectImpersonation({ title: 'PayPal - Connexion', visibleText: 'Connectez-vous à votre compte PayPal. Mot de passe', hasPasswordField: true }).verdict).toBe('block');
    expect(detectImpersonation({ title: 'Sécurité Orange Money', visibleText: 'Vérifiez votre compte, saisissez votre mot de passe', hasPasswordField: true }).verdict).toBe('block');
    expect(detectImpersonation({ title: 'Clone de la page de connexion Google — exercice', visibleText: 'Sign in password', hasPasswordField: true }).verdict).not.toBe('block');
    expect(detectImpersonation({ title: 'Boutique de thé', visibleText: 'Paiement par PayPal accepté', hasPasswordField: false }).verdict).toBe('clear');
  });
});

describe('privacy', () => {
  it('finds emails and phone numbers, but not placeholders, years or prices', () => {
    const found = findPersonalData('Écrivez à marie.dupont@gmail.com ou appelez le +33 6 12 34 56 78 / 677 12 34 56. Depuis 2019-2024, 1 299 €, contact@example.com');
    expect(found.emails).toEqual(['marie.dupont@gmail.com']);
    expect(found.phones.length).toBe(2);
  });

  it('asks the owner to remove personal data from the title or description', () => {
    expect(privacyCheck({ title: 'Mon CV', description: 'Joignez-moi : jean@gmail.com' })).toMatchObject({ outcome: 'fail', code: 'personal_data_in_text' });
    expect(privacyCheck({ title: 'Mon CV', description: 'Un CV en ligne.' }).outcome).toBe('pass');
  });
});

describe('technical and quality', () => {
  it('fails an unreachable or empty page and a page that crashes', () => {
    expect(technicalCheck({ ...richPage, reachable: false }).code).toBe('unreachable');
    expect(technicalCheck({ ...richPage, textLength: 2, imageCount: 0 }).code).toBe('empty_render');
    expect(technicalCheck({ ...richPage, pageErrors: ['TypeError: x is undefined'] }).code).toBe('page_error');
    expect(technicalCheck(richPage).outcome).toBe('pass');
  });

  it('scores a rich page high and a bare one low, between 0 and 100', () => {
    const rich = qualityScore(richPage);
    const bare = qualityScore({ reachable: true, textLength: 25 });
    expect(rich).toBeGreaterThan(85);
    expect(bare).toBeLessThan(35);
    expect(rich).toBeLessThanOrEqual(100);
    expect(bare).toBeGreaterThanOrEqual(0);
  });

  it('fails an unmodified starter, lists a login-only page without featuring it', () => {
    const starter = STARTERS['react-vite'];
    const untouched = [{ path: starter.entryPath, content: STARTER_ENTRY_PLACEHOLDER }];
    expect(qualityCheck(richPage, untouched)).toMatchObject({ outcome: 'fail', code: 'unmodified_template' });
    const own = [{ path: starter.entryPath, content: 'export default function App(){ return <main>Mon app</main> }' }];
    expect(qualityCheck({ ...richPage, loginOnly: true }, own)).toMatchObject({ outcome: 'warn', code: 'login_only' });
    expect(qualityCheck(richPage, own).outcome).toBe('pass');
  });
});

describe('near-duplicates', () => {
  const text = (word = 'goûter') => `Bienvenue à la boulangerie du coin. Nos pains frais sont cuits chaque matin avec de la farine locale. Découvrez nos viennoiseries, nos tartes et nos gâteaux faits maison. Passez nous voir du mardi au dimanche pour ${word} la différence. Notre équipe vous accueille avec le sourire dans une boutique chaleureuse au centre ville, près de la place du marché.`;
  it('puts the same words a few bits apart and different words far apart', () => {
    const a = contentFingerprint([], text());
    const b = contentFingerprint([], text('découvrir'));
    const c = contentFingerprint([], 'Tableau de bord des ventes avec graphiques, filtres par région et export CSV pour les équipes commerciales qui suivent leurs objectifs mensuels et trimestriels.');
    expect(a).toHaveLength(16);
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(4);
    expect(hammingDistance(a, c)).toBeGreaterThan(10);
    expect(duplicateCheck(a, [{ id: '1', title: 'Boulangerie', fingerprint: b }])).toMatchObject({ outcome: 'fail', code: 'near_duplicate' });
    expect(duplicateCheck(a, [{ id: '2', title: 'Ventes', fingerprint: c }]).outcome).toBe('pass');
    expect(duplicateCheck('', []).outcome).toBe('pass');
  });
});

describe('the verdict', () => {
  const ok = (key: any, extra: any = {}) => ({ key, outcome: 'pass' as const, code: `${key}_ok`, reason: 'ok', ...extra });
  it('lets the worst outcome decide', () => {
    expect(decideVerdict([ok('technical'), { ...ok('security'), outcome: 'block', code: 'secret_in_browser_code' }]).state).toBe('refused');
    expect(decideVerdict([ok('technical'), { ...ok('privacy'), outcome: 'fail', code: 'personal_data_in_text' }])).toMatchObject({ state: 'needs_fix', severity: 'minor' });
    expect(decideVerdict([{ ...ok('technical'), outcome: 'fail', code: 'empty_render' }])).toMatchObject({ state: 'needs_fix', severity: 'major' });
  });

  it('keeps a warning online but out of the featured places', () => {
    const verdict = decideVerdict([ok('technical'), { ...ok('quality'), outcome: 'warn', code: 'low_quality', data: { score: 20, featurable: false } }]);
    expect(verdict).toMatchObject({ state: 'online', featurable: false, qualityScore: 20 });
    expect(decideVerdict([ok('quality', { data: { score: 88, featurable: true } })])).toMatchObject({ state: 'online', featurable: true });
    expect(decideVerdict([ok('quality', { data: { score: 50, featurable: false } })]).featurable).toBe(false);
  });

  it('on a republication keeps the last validated version unless the failure is critical', () => {
    const minor = decideVerdict([{ key: 'privacy', outcome: 'fail', code: 'x', reason: 'r' }]);
    const critical = decideVerdict([{ key: 'security', outcome: 'block', code: 'x', reason: 'r' }]);
    const good = decideVerdict([ok('technical')]);
    expect(republicationOutcome(good, true)).toBe('replace');
    expect(republicationOutcome(minor, true)).toBe('keep_previous');
    expect(republicationOutcome(minor, false)).toBe('remove');
    expect(republicationOutcome(critical, true)).toBe('remove');
  });
});

describe('categories', () => {
  it('guesses a category from what the app says, falls back to « autre »', () => {
    expect(classifyCategory({ title: 'Ma boutique de thé', description: 'Ajoutez au panier, paiement sécurisé' }).slug).toBe('e-commerce');
    expect(classifyCategory({ title: 'Portfolio de Lina', description: 'Mes réalisations de photographe' }).slug).toBe('portfolio');
    expect(classifyCategory({ title: 'Quiz de géographie', description: 'Un jeu avec score et niveaux' }).slug).toBe('jeux');
    expect(classifyCategory({ title: 'Dashboard commercial', description: 'KPI et statistiques' }).slug).toBe('tableau-de-bord');
    expect(classifyCategory({ title: 'Xyzzy', description: '' })).toEqual({ slug: 'autre', confidence: 0 });
  });
});
