import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canShareProject, generateShareToken, hashShareToken, isShareActive, isWellFormedShareToken, sameHash, shareExpiry, sharedProjectView } from './project-share';

describe('the link’s secret', () => {
  it('is long, random, URL-safe, and never the same twice', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateShareToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) { expect(token).toHaveLength(32); expect(isWellFormedShareToken(token)).toBe(true); }
  });

  it('is checked for shape before anything touches the database', () => {
    for (const bad of ['', 'short', 'x'.repeat(33), `${'a'.repeat(31)}!`, `${'a'.repeat(31)} `, null, undefined, 42, '../etc/passwd'.padEnd(32, 'a')]) expect(isWellFormedShareToken(bad)).toBe(false);
  });

  it('is stored as a hash that cannot be turned back, and compared without timing leaks', () => {
    const token = generateShareToken();
    const hash = hashShareToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashShareToken(token)).toBe(hash);
    expect(sameHash(hash, hashShareToken(token))).toBe(true);
    expect(sameHash(hash, hashShareToken(generateShareToken()))).toBe(false);
    expect(sameHash(hash, 'short')).toBe(false);
  });
});

describe('when a link works', () => {
  const now = Date.parse('2026-09-30T20:00:00Z');
  it('until it is revoked or past its date', () => {
    expect(isShareActive({ revoked_at: null, expires_at: shareExpiry(now) }, now)).toBe(true);
    expect(isShareActive({ revoked_at: null, expires_at: null }, now)).toBe(true);
    expect(isShareActive({ revoked_at: '2026-09-30T19:00:00Z', expires_at: shareExpiry(now) }, now)).toBe(false);
    expect(isShareActive({ revoked_at: null, expires_at: new Date(now - 1000).toISOString() }, now)).toBe(false);
    expect(isShareActive({ revoked_at: null, expires_at: 'n/a' }, now)).toBe(false);
    expect(isShareActive(null, now)).toBe(false);
  });

  it('lasts thirty days by default', () => {
    expect(Date.parse(shareExpiry(now)) - now).toBe(30 * 86_400_000);
  });
});

describe('who may share', () => {
  it('owners and admins, not editors or viewers', () => {
    expect(canShareProject('owner')).toBe(true);
    expect(canShareProject('admin')).toBe(true);
    for (const role of ['editor', 'viewer', null, undefined, '']) expect(canShareProject(role as any)).toBe(false);
  });
});

describe('what a stranger sees', () => {
  it('is the name, a short description and the saved preview — bounded, with no owner and no files', () => {
    const view = sharedProjectView({ name: 'Mon site', prompt: `  Un site\n\n${'très long '.repeat(100)}`, preview_html: '<p>x</p>', user_id: 'secret', owner_id: 'secret' } as any, { files: 24.4, shared_at: '2026-09-30T00:00:00Z' });
    expect(Object.keys(view).sort()).toEqual(['description', 'files', 'name', 'preview_html', 'shared_at']);
    expect(view.description.length).toBeLessThanOrEqual(240);
    expect(view.description).not.toContain('\n');
    expect(view.files).toBe(24);
    expect(JSON.stringify(view)).not.toContain('secret');
  });
});

describe('the migration', () => {
  const sql = readFileSync('supabase/migrations/20260930231000_project_shares.sql', 'utf8');
  it('stores a hash, cascades with the project, and is closed to everything but the server', () => {
    expect(sql).toMatch(/token_hash text not null unique/);
    expect(sql).not.toMatch(/\btoken text\b/);
    expect(sql).toMatch(/references public\.projects\(id\) on delete cascade/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
  });
});

describe('the routes', () => {
  const server = readFileSync('server.ts', 'utf8');
  const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
  const owner = strip(server.slice(server.indexOf("app.post('/api/projects/:id/share'"), server.indexOf('/** A shared link, resolved')));
  const publicPart = strip(server.slice(server.indexOf('/** A shared link, resolved'), server.indexOf("app.get('/api/projects/:id/state',")));

  it('the owner’s routes check the role before they touch the shares', () => {
    for (const method of ["app.post('/api/projects/:id/share'", "app.delete('/api/projects/:id/share'", "app.get('/api/projects/:id/share'"]) {
      const at = owner.indexOf(method);
      expect(at).toBeGreaterThan(-1);
      const body = owner.slice(at, owner.indexOf('\n});', at));
      expect(body).toMatch(/canShareProject\(getUserProjectRole\(req, project\)\)/);
    }
  });

  it('creating a link revokes the previous one and stores only the hash', () => {
    expect(owner).toMatch(/update\(\{ revoked_at: new Date\(\)\.toISOString\(\) \}\)\.eq\('project_id', project\.id\)\.is\('revoked_at', null\)/);
    expect(owner).toMatch(/token_hash: hashShareToken\(token\)/);
    expect(owner).not.toMatch(/insert\(\[\{[^}]*\btoken:/);
    expect(owner).toMatch(/no-store/);
  });

  it('a stranger’s routes check the shape first, answer alike for missing, expired and revoked, and limit themselves', () => {
    expect(publicPart).toMatch(/if \(!isWellFormedShareToken\(token\)\) return null;/);
    expect(publicPart).toMatch(/sameHash\(data\.token_hash/);
    expect(publicPart).toMatch(/isShareActive\(data\)/);
    expect(publicPart.match(/Ce lien n’existe pas ou n’est plus actif\./g)?.length).toBe(2);
    expect(publicPart).toMatch(/enforceRateLimit\(`share-view:/);
    expect(publicPart).toMatch(/enforceRateLimit\(`share-copy:/);
    expect(publicPart).toMatch(/Referrer-Policy/);
  });

  it('the public view is built by the bounded view function, and the copy needs an account and lands in the copier’s own organization', () => {
    expect(publicPart).toMatch(/sharedProjectView\(found\.project/);
    expect(publicPart).not.toMatch(/res\.json\(\{ success: true, project: found\.project/);
    const copy = publicPart.slice(publicPart.indexOf("app.post('/api/share/:token/copy'"));
    expect(copy.indexOf('requireAuthenticatedUser(req, res)')).toBeLessThan(copy.indexOf('resolveShare('));
    expect(copy).toMatch(/ensurePersonalOrganization\(req, authUser\.id\)/);
    expect(copy).toMatch(/duplicatedVia: 'share'/);
  });
});

describe('the page and the menu', () => {
  const page = readFileSync('share.html', 'utf8');
  const script = readFileSync('src/share-page.ts', 'utf8');
  const builder = readFileSync('src/builder-live.ts', 'utf8');

  it('the page is not indexed, leaks no referrer, and frames the preview without the page’s own origin', () => {
    expect(page).toMatch(/name="robots" content="noindex, nofollow"/);
    expect(page).toMatch(/name="referrer" content="no-referrer"/);
    expect(script).toMatch(/setAttribute\('sandbox', 'allow-scripts'\)/);
    expect(script).not.toMatch(/allow-same-origin/);
  });

  it('writes what it is given as text, never as markup', () => {
    expect(script).not.toMatch(/innerHTML/);
    expect(script).toMatch(/textContent = view\.description/);
  });

  it('asks for an account only when making the copy, through the client that sends people to sign in and back', () => {
    expect(script).toMatch(/apiFetch<\{ builder_url\?: string \}>\(`\/api\/share\/\$\{encodeURIComponent\(token\)\}\/copy`/);
    expect(script).toMatch(/fetch\(path, \{ headers: \{ Accept: 'application\/json' \}, cache: 'no-store', referrerPolicy: 'no-referrer' \}\)/);
  });

  it('the project menu shows the link once, copies it, revokes it, and hides itself from anyone who is not the owner', () => {
    const menu = builder.slice(builder.indexOf('async function refreshShareMenu'), builder.indexOf('function bindProjectMenu'));
    expect(menu).toMatch(/box\.hidden = true/);
    expect(menu).toMatch(/il ne sera plus affiché/);
    expect(menu).toMatch(/method: 'DELETE'/);
    expect(menu).toMatch(/navigator\.clipboard\.writeText/);
    expect(menu).not.toMatch(/innerHTML/);
  });
});
