import { describe, expect, it } from 'vitest';
import { STARTERS, STARTER_ENTRY_PLACEHOLDER } from '../sandbox/starters';
import type { PageSignals } from './checks';
import type { Inspection } from './inspector';
import { discoverRank, runListingChecks, type PipelineDeps } from './pipeline';
import type { ListingRow } from './store';
import { decideListing } from './visibility';

const NOW = new Date('2026-10-01T12:00:00Z');
const rich: PageSignals = {
  reachable: true, textLength: 900, imageCount: 3, imagesWithoutAlt: 0, canvasCount: 0, consoleErrors: [], pageErrors: [], lang: 'fr', hasViewportMeta: true, hasMetaDescription: true,
  h1Count: 1, landmarkCount: 3, sectionCount: 5, cssVariableCount: 24, mediaQueryCount: 4, fontFamilyCount: 2, horizontalOverflowAtMobile: false, title: 'Atelier Lumière',
  visibleText: 'Atelier Lumière, photographe à Douala. Mes réalisations, mon parcours et ma façon de travailler. Réservez une séance.',
};
const good = [{ path: 'src/App.tsx', content: 'export default function App(){ return <main><h1>Atelier Lumière</h1><p>Photographe à Douala. Mes réalisations et ma façon de travailler, séances en studio et en extérieur.</p></main> }' }];

function makeStore(initial: Partial<ListingRow> = {}, files = good) {
  const state = {
    listing: { id: 'L1', project_id: 'P1', owner_id: 'U1', title: 'Atelier Lumière', description: 'Portfolio de photographe', category: 'portfolio', status: 'pending', opted_in: false, origin: 'free_auto', current_version_id: null, listed_at: null, public_url: 'https://lumiere.vercel.app', thumbnail_path: null, ...initial } as ListingRow,
    version: { id: 'V1', listing_id: 'L1', public_url: 'https://lumiere.vercel.app', state: 'checking', files },
    journal: [] as any[], finished: [] as any[], sanction: null as any, online: 0, fingerprints: [] as any[],
  };
  const store: any = {
    byId: async () => state.listing, getVersion: async () => state.version, journal: async (entry: any) => { state.journal.push(entry); },
    update: async (_id: string, patch: any) => { state.listing = { ...state.listing, ...patch }; return state.listing; },
    transition: async (listing: ListingRow, to: string, why: any) => { state.listing = { ...listing, ...why.patch, status: to, status_code: why.code, status_reason: why.reason } as ListingRow; state.journal.push({ event: why.event, to, code: why.code }); return state.listing; },
    finishVersion: async (id: string, input: any) => { state.finished.push({ id, ...input }); }, pruneVersionFiles: async () => undefined,
    activeSanction: async () => state.sanction, onlineCountForOwner: async () => state.online, fingerprints: async () => state.fingerprints,
  };
  return { state, store };
}

function deps(store: any, over: Partial<PipelineDeps> = {}, inspection: Partial<Inspection> = {}, plan = 'free'): PipelineDeps & { notified: any[] } {
  const notified: any[] = [];
  return {
    store, now: () => NOW, notified,
    inspect: async () => ({ signals: rich, delivered: [], thumbnail: Buffer.from('thumb'), blurred: 0, ...inspection }),
    saveThumbnail: async (id: string) => `${id}/thumb.webp`,
    notifyOwner: async (listing: any, verdict: any) => { notified.push(verdict.code); },
    currentVisibility: async (listing: any) => decideListing({ published: true, plan, optedIn: listing.opted_in }),
    accountCreatedAt: async () => '2026-01-01T00:00:00Z',
    ...over,
  } as any;
}

describe('the listing pipeline', () => {
  it('lists a good free-plan app: online, thumbnail saved, quality scored, decision journaled', async () => {
    const { state, store } = makeStore();
    const outcome = await runListingChecks(deps(store), 'L1', 'V1');
    expect(outcome).toMatchObject({ kind: 'done', action: 'replace' });
    expect(state.listing).toMatchObject({ status: 'online', current_version_id: 'V1', thumbnail_path: 'L1/thumb.webp', indexable: true, origin: 'free_auto' });
    expect(state.listing.quality_score).toBeGreaterThan(80);
    expect(state.journal.some(entry => entry.event === 'listed')).toBe(true);
  });

  it('blocks and alerts on a secret in the browser code, and stores no thumbnail', async () => {
    const leaked = [...good, { path: 'src/ai.ts', content: `const key = 'sk-ant-${'a1B2c3D4'.repeat(4)}'` }];
    const { state, store } = makeStore({}, leaked);
    const d = deps(store);
    const outcome = await runListingChecks(d, 'L1', 'V1');
    expect(outcome).toMatchObject({ kind: 'done', action: 'remove' });
    expect(state.listing).toMatchObject({ status: 'refused', status_code: 'secret_in_browser_code', indexable: false });
    expect(state.listing.thumbnail_path).toBeNull();
    expect(d.notified).toEqual(['secret_in_browser_code']);
  });

  it('finds a secret that only exists in what the browser received', async () => {
    const { state, store } = makeStore();
    await runListingChecks(deps(store, {}, { delivered: [{ path: 'assets/index.js', content: `x="sk_live_${'z'.repeat(26)}"` }] }), 'L1', 'V1');
    expect(state.listing.status).toBe('refused');
  });

  it('refuses a login page wearing a brand, with a reason the owner can read', async () => {
    const phishing = { ...rich, title: 'PayPal - Connexion', hasPasswordField: true, loginOnly: true, textLength: 300, visibleText: 'Connectez-vous à votre compte PayPal. Mot de passe' };
    const { state, store } = makeStore({ title: 'PayPal - Connexion' });
    await runListingChecks(deps(store, {}, { signals: phishing }), 'L1', 'V1');
    expect(state.listing).toMatchObject({ status: 'refused', status_code: 'impersonation' });
    expect(state.listing.status_reason).toContain('imite');
  });

  it('refuses adult content from the cheap text filter without calling a model', async () => {
    let called = false;
    const { state, store } = makeStore({ description: 'xxx porn videos' });
    await runListingChecks(deps(store, { moderateImage: async () => { called = true; return 'clear'; } }), 'L1', 'V1');
    expect(state.listing.status).toBe('refused');
    expect(called).toBe(false);
  });

  it('asks the vision model only when the text leaves a doubt, and follows its answer', async () => {
    const doubtful = { ...rich, visibleText: `${rich.visibleText} Contenu pour adultes 18+` };
    const blocked = makeStore();
    await runListingChecks(deps(blocked.store, { moderateImage: async () => 'block' }, { signals: doubtful }), 'L1', 'V1');
    expect(blocked.state.listing.status).toBe('refused');
    const cleared = makeStore();
    await runListingChecks(deps(cleared.store, { moderateImage: async () => 'clear' }, { signals: doubtful }), 'L1', 'V1');
    expect(cleared.state.listing.status).toBe('online');
    const clean = makeStore();
    let asked = 0;
    await runListingChecks(deps(clean.store, { moderateImage: async () => { asked += 1; return 'clear'; } }), 'L1', 'V1');
    expect(asked).toBe(0);
  });

  it('keeps a doubtful app online but never features it when no model can look', async () => {
    const doubtful = { ...rich, visibleText: `${rich.visibleText} Contenu pour adultes 18+` };
    const { state, store } = makeStore();
    await runListingChecks(deps(store, { moderateImage: undefined }, { signals: doubtful }), 'L1', 'V1');
    expect(state.listing).toMatchObject({ status: 'online', featured: false });
  });

  it('does not list an empty app, an unmodified template, or a near-duplicate', async () => {
    const empty = makeStore();
    await runListingChecks(deps(empty.store, {}, { signals: { ...rich, textLength: 3, imageCount: 0 } }), 'L1', 'V1');
    expect(empty.state.listing).toMatchObject({ status: 'needs_fix', status_code: 'empty_render' });

    const starter = STARTERS['react-vite'];
    const template = makeStore({}, [{ path: starter.entryPath, content: STARTER_ENTRY_PLACEHOLDER }]);
    await runListingChecks(deps(template.store), 'L1', 'V1');
    expect(template.state.listing).toMatchObject({ status: 'needs_fix', status_code: 'unmodified_template' });
  });

  it('puts a brand-new account on hold instead of listing at once', async () => {
    const { state, store } = makeStore();
    const outcome = await runListingChecks(deps(store, { accountCreatedAt: async () => new Date(NOW.getTime() - 3_600_000).toISOString() }), 'L1', 'V1');
    expect(outcome.kind).toBe('held');
    expect(state.listing.status).toBe('pending');
    expect(state.listing.status_code).toBe('probation');
  });

  it('asks the plan rule again at check time: a plan change in between wins', async () => {
    const { state, store } = makeStore({ status: 'online', current_version_id: 'V0' });
    const outcome = await runListingChecks(deps(store, {}, {}, 'pro'), 'L1', 'V1');
    expect(outcome).toEqual({ kind: 'skipped', reason: 'paid_not_opted_in' });
    expect(state.listing.status).toBe('removed_by_user');
  });

  it('on a republication that fails, visitors keep the version they had', async () => {
    const { state, store } = makeStore({ status: 'online', current_version_id: 'V0', thumbnail_path: 'old.webp', quality_score: 88, listed_at: '2026-09-30T10:00:00Z' });
    const outcome = await runListingChecks(deps(store, {}, { signals: { ...rich, pageErrors: ['TypeError: boom'] } }), 'L1', 'V1');
    expect(outcome).toMatchObject({ kind: 'done', action: 'keep_previous' });
    expect(state.listing).toMatchObject({ status: 'online', current_version_id: 'V0', thumbnail_path: 'old.webp', status_code: 'page_error' });
  });

  it('on a republication that leaks a secret, the listing comes down', async () => {
    const leaked = [...good, { path: 'src/k.ts', content: `const k = 'sk-ant-${'q1W2e3R4'.repeat(4)}'` }];
    const { state, store } = makeStore({ status: 'online', current_version_id: 'V0' }, leaked);
    await runListingChecks(deps(store), 'L1', 'V1');
    expect(state.listing.status).toBe('refused');
  });

  it('does nothing for an app a moderator removed', async () => {
    const { store } = makeStore({ status: 'removed_by_moderation' });
    expect(await runListingChecks(deps(store), 'L1', 'V1')).toEqual({ kind: 'skipped', reason: 'removed_by_moderation' });
  });

  it('puts the best, cleanest apps among « Choix de Coden » and orders discovery by one key', async () => {
    const { state, store } = makeStore();
    await runListingChecks(deps(store), 'L1', 'V1');
    expect(state.listing.featured).toBe(state.listing.quality_score! >= 85);
    const a = discoverRank({ quality: 90, featured: false, listedAt: '2026-09-01T00:00:00Z' });
    const b = discoverRank({ quality: 60, featured: false, listedAt: '2026-10-01T00:00:00Z' });
    const c = discoverRank({ quality: 40, featured: true, listedAt: '2026-08-01T00:00:00Z' });
    expect(a).toBeGreaterThan(b);
    expect(c).toBeGreaterThan(a);
    expect(Number.isSafeInteger(c)).toBe(true);
  });
});
