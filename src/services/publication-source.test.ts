import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadPublicationFiles, publicationSourceReady } from './publication-source.ts';
import { applyStarter, STARTERS } from './sandbox/starters.ts';

describe('publication while an agent is still working', () => {
  const app = [{ path: 'src/App.tsx', content: 'export default function App(){return <main>My site</main>}' }];

  it('uses a saved first-build checkpoint before the generation has finished', async () => {
    expect(await loadPublicationFiles({ committed: async () => [], checkpoint: async () => app })).toEqual(app);
    expect(publicationSourceReady(app)).toBe(true);
  });

  it('keeps the complete committed application instead of mixing in an unfinished edit', async () => {
    const committed = [...app, { path: 'src/index.css', content: '.site { color: blue; }' }];
    const checkpoint = vi.fn(async () => [{ path: 'src/App.tsx', content: 'unfinished' }]);
    expect(await loadPublicationFiles({ committed: async () => committed, checkpoint })).toEqual(committed);
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it('freezes the selected tree even if the next round changes or removes files', async () => {
    const draft = app.map(file => ({ ...file }));
    const captured = await loadPublicationFiles({ committed: async () => [], checkpoint: async () => draft });
    draft[0].content = 'unfinished next round';
    draft.length = 0;
    expect(captured).toEqual(app);
  });

  it('does not reinterpret database failures as an empty project or read another revision', async () => {
    const checkpoint = vi.fn(async () => app);
    await expect(loadPublicationFiles({ committed: async () => { throw new Error('unavailable'); }, checkpoint })).rejects.toThrow('unavailable');
    expect(checkpoint).not.toHaveBeenCalled();
    await expect(loadPublicationFiles({ committed: async () => [], checkpoint: async () => { throw new Error('unavailable'); } })).rejects.toThrow('unavailable');
  });

  it('does not offer publication for an empty project, metadata only or the untouched starter', () => {
    expect(publicationSourceReady([])).toBe(false);
    expect(publicationSourceReady([{ path: 'package.json', content: '{}' }])).toBe(false);
    for (const starter of Object.values(STARTERS)) {
      expect(publicationSourceReady(applyStarter(starter, []).files)).toBe(false);
      expect(publicationSourceReady(applyStarter(starter, app).files)).toBe(true);
    }
  });

  it('supports static sites and server-rendered pages', () => {
    expect(publicationSourceReady([{ path: 'index.html', content: '<main>My site</main>' }])).toBe(true);
    expect(publicationSourceReady([{ path: 'app/page.tsx', content: 'export default function Page(){return <main>My site</main>}' }])).toBe(true);
  });

  it('does not gate publication on the final preview flag and preserves security and hosting checks', () => {
    const server = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
    const start = server.indexOf('function buildPublishStatus(');
    const status = server.slice(start, server.indexOf('\nfunction ', start + 1));
    expect(status).toContain('const previewReady = publicationSourceReady(files);');
    expect(status).toContain('can_publish: hostingConfigured && previewReady && hasFiles && !securityBlocking.length');
    const context = server.slice(server.indexOf('async function createPublishContext('), server.indexOf('function getPublishPublicUrl('));
    expect(context).toContain('loadPublicationFiles(');
    expect(context).toContain('loadDurableProjectSnapshot(project.id, project.owner_id)');
  });

  it('removes the finish-generation banner and allows an idempotent repeat publication', () => {
    const builder = readFileSync(new URL('../builder-live.ts', import.meta.url), 'utf8');
    expect(builder).not.toContain('Terminez la génération de votre application.');
    expect(builder).not.toContain('<strong>Avant de publier</strong>');
    expect(builder).toContain('const canPublish = Boolean(status?.can_publish && !isPublishing);');
  });
});
