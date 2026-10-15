import { describe, expect, it } from 'vitest';
import { IsolatedPublicationBuilder } from './isolated-builder.ts';
import { serializeBuiltArtifact } from './cloudflare-provider.ts';
import type { PublicationSnapshot } from './model.ts';
const snapshot: PublicationSnapshot = { id: 'new-release', project_id: 'project', actor_id: 'owner', files: [{ path: 'index.html', content: '<head><title>Old</title></head><h1>Application</h1>' }], manifest: { runtime: 'static-assets' }, public_env: {}, fingerprint: 'fingerprint', settings: { subdomain: 'project-demo', audience: 'invite_only', invitations: [], metadata: { title: 'Titre choisi', description: 'Description', favicon: null, image: null } } };
describe('Isolated publication builder', () => {
  it('marks built HTML, applies metadata and preserves original source', async () => {
    const result = await new IsolatedPublicationBuilder('coden.test').build(snapshot);
    const html = new TextDecoder().decode(result.assets![0].bytes);
    expect(html).toContain('name="coden-release" content="new-release"');
    expect(html).toContain('<title>Titre choisi</title>');
    expect(snapshot.files[0].content).toContain('<title>Old</title>');
  });
  it('refuses Node and Vercel runtime instead of discarding their server', async () => {
    for (const runtime of ['node-server', 'vercel-functions']) await expect(new IsolatedPublicationBuilder('coden.test').build({ ...snapshot, manifest: { runtime } })).rejects.toMatchObject({ code: 'WORKER_RUNTIME_REQUIRED' });
  });
  it('repackages retained content with a new marker and current metadata', async () => {
    const old = serializeBuiltArtifact({ runtime: 'static-assets', assets: [{ path: '/index.html', contentType: 'text/html', bytes: new TextEncoder().encode('<head><meta name="coden-release" content="old-release"><title>Ancien titre</title></head><h1>Ancien contenu</h1>') }] });
    const builder = new IsolatedPublicationBuilder('coden.test', async () => old);
    const result = await builder.build({ ...snapshot, restored_from: 'old-release' });
    const html = new TextDecoder().decode(result.assets![0].bytes);
    expect(html).toContain('Ancien contenu'); expect(html).toContain('new-release'); expect(html).not.toContain('old-release'); expect(html).toContain('Titre choisi');
  });
});
