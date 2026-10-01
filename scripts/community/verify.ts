/**
 * Runs the Community's real pipeline over the thirty-four test apps, in a real browser, and writes the result.
 *
 *   node --experimental-strip-types scripts/community/verify.ts
 *
 * Apps are served from a local port; the inspector is the production one (fresh browser, no cookies, blur, WebP
 * thumbnail); the store is in memory. Only the database and the mailbox are faked. The output is docs/community-verification.md.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { STARTERS, STARTER_ENTRY_PLACEHOLDER } from '../../src/services/sandbox/starters.ts';
import { inspectPublicPage } from '../../src/services/community/inspector.ts';
import { runListingChecks, type PipelineDeps } from '../../src/services/community/pipeline.ts';
import { decideListing } from '../../src/services/community/visibility.ts';
import { FIXTURES, type Fixture } from './fixtures.ts';

const outDir = path.resolve(import.meta.dirname, '../../docs');
const server = http.createServer((req, res) => {
  const id = String(req.url || '').split('/')[1];
  const fixture = FIXTURES.find(item => item.id === id);
  if (!fixture) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(fixture.html);
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;

type Row = { fixture: Fixture; outcome: string; code: string; reason: string; featured: boolean; quality: number | null; ms: number; blurred: number; thumbBytes: number; ok: boolean };
const rows: Row[] = [];
const onlineFingerprints: Array<{ id: string; title: string; fingerprint: string }> = [];
const savedThumbs: Record<string, Buffer> = {};

for (const fixture of FIXTURES) {
  const src = fixture.src.map(file => (file.content === '__STARTER__' ? { path: STARTERS['react-vite'].entryPath, content: STARTER_ENTRY_PLACEHOLDER } : file));
  const state: any = {
    listing: { id: fixture.id, project_id: `p-${fixture.id}`, owner_id: `u-${fixture.id}`, title: fixture.title, description: '', category: 'autre', status: 'pending', opted_in: Boolean(fixture.optedIn), origin: 'free_auto', current_version_id: null, listed_at: null, public_url: `${origin}/${fixture.id}/`, thumbnail_path: null },
    version: { id: `v-${fixture.id}`, listing_id: fixture.id, public_url: `${origin}/${fixture.id}/`, state: 'checking', files: src },
  };
  const store: any = {
    byId: async () => state.listing, getVersion: async () => state.version, journal: async () => undefined,
    update: async (_id: string, patch: any) => { state.listing = { ...state.listing, ...patch }; return state.listing; },
    transition: async (listing: any, to: string, why: any) => { state.listing = { ...listing, ...why.patch, status: to, status_code: why.code, status_reason: why.reason }; return state.listing; },
    finishVersion: async () => undefined, pruneVersionFiles: async () => undefined, activeSanction: async () => null, onlineCountForOwner: async () => 0,
    fingerprints: async () => onlineFingerprints,
  };
  let blurred = 0; let thumbBytes = 0; const started = Date.now();
  const deps: PipelineDeps = {
    store, notifyOwner: async () => undefined, accountCreatedAt: async () => '2025-01-01T00:00:00Z',
    inspect: async url => { const result = await inspectPublicPage(url, { testOrigin: origin }); blurred = result.blurred; thumbBytes = result.thumbnail?.length || 0; if (result.thumbnail) savedThumbs[fixture.id] = result.thumbnail; return result; },
    saveThumbnail: async (id: string) => `${id}/t.webp`,
    currentVisibility: async () => decideListing({ published: fixture.published !== false, protection: fixture.protection, plan: fixture.plan || 'free', optedIn: fixture.optedIn }),
  };
  const result = await runListingChecks(deps, fixture.id, `v-${fixture.id}`);
  const listing = state.listing;
  let outcome: string;
  if (result.kind === 'skipped') outcome = 'not_listed';
  else if (listing.status === 'online') outcome = (result as any).verdict?.featurable ? 'online' : 'online_plain';
  else outcome = listing.status;
  if (listing.status === 'online' && listing.content_fingerprint) onlineFingerprints.push({ id: fixture.id, title: fixture.title, fingerprint: listing.content_fingerprint });
  // « online » is satisfied by online or online_plain only when the fixture does not require « plain ».
  // A thumbnail must never carry readable personal data: the page with an email and a phone must blur both.
  const blurOk = fixture.id !== 't09' || blurred >= 2;
  const ok = blurOk && (fixture.expect === 'online' && fixture.kind !== 'good' ? outcome.startsWith('online') : outcome === fixture.expect);
  rows.push({ fixture, outcome, code: listing.status_code || (result.kind === 'skipped' ? (result as any).reason : ''), reason: listing.status_reason || '', featured: Boolean(listing.featured), quality: listing.quality_score ?? null, ms: Date.now() - started, blurred, thumbBytes, ok });
  process.stdout.write(`${ok ? '✓' : '✗'} ${fixture.id} ${fixture.title.padEnd(36)} expected ${fixture.expect.padEnd(11)} got ${outcome.padEnd(11)} ${listing.status_code || ''}\n`);
}
server.close();

const harmful = rows.filter(row => row.fixture.harmful);
const benign = rows.filter(row => !row.fixture.harmful);
const falseNegatives = harmful.filter(row => row.outcome.startsWith('online'));
const falsePositives = benign.filter(row => !row.outcome.startsWith('online'));
const wrong = rows.filter(row => !row.ok);
const ms = rows.map(row => row.ms).sort((a, b) => a - b);
const report = [
  '# Vérification de la Communauté — 34 apps de test',
  '',
  `Générée par \`scripts/community/verify.ts\` le ${new Date().toISOString().slice(0, 10)}. Pipeline réel (navigateur réel, flou des données personnelles, miniature WebP), base de données et e-mails simulés. Aucun modèle de vision : les cas douteux sont listés sans mise en avant.`,
  '',
  `- Décisions conformes à l'attendu : **${rows.length - wrong.length}/${rows.length}**`,
  `- Apps nuisibles ou invalides (${harmful.length}) listées à tort — faux négatifs : **${falseNegatives.length}** (${Math.round((falseNegatives.length / Math.max(1, harmful.length)) * 100)} %)`,
  `- Apps légitimes (${benign.length}) bloquées à tort — faux positifs : **${falsePositives.length}** (${Math.round((falsePositives.length / Math.max(1, benign.length)) * 100)} %)`,
  `- Durée d'un contrôle complet (navigateur compris) : médiane ${ms[Math.floor(ms.length / 2)]} ms, maximum ${ms[ms.length - 1]} ms`,
  '',
  '| # | App | Type | Attendu | Obtenu | Code | Qualité | Pourquoi |',
  '|---|-----|------|---------|--------|------|---------|----------|',
  ...rows.map(row => `| ${row.fixture.id} | ${row.fixture.title} | ${row.fixture.kind} | ${row.fixture.expect} | ${row.ok ? '✓ ' : '✗ '}${row.outcome} | ${row.code || '—'} | ${row.quality ?? '—'} | ${row.fixture.why} |`),
  '',
  `Miniature de t09 : ${rows.find(row => row.fixture.id === 't09')?.blurred ?? 0} élément(s) flouté(s) (e-mail et téléphone visibles sur la page).`,
].join('\n');
fs.writeFileSync(path.join(outDir, 'community-verification.md'), `${report}\n`);
fs.mkdirSync(path.join(outDir, 'community-screens'), { recursive: true });
for (const id of ['t09', 'g01']) if (savedThumbs[id]) fs.writeFileSync(path.join(outDir, 'community-screens', `thumbnail-${id}.webp`), savedThumbs[id]);
console.log(`\n${rows.length - wrong.length}/${rows.length} conformes · faux négatifs ${falseNegatives.length} · faux positifs ${falsePositives.length}`);
process.exit(0);
