import { describe, expect, it } from 'vitest';
import { authoritativeProjectFiles, loadGenerationFiles } from './project-file-recovery.ts';

describe('project file recovery', () => {
  it('resumes saved first-build files on a new request after reload', async () => {
    const draft = [{ path: 'src/App.tsx', content: 'unfinished but saved' }];
    expect(await loadGenerationFiles({ committed: async () => [], checkpoint: async () => draft })).toEqual(draft);
  });
  it('does not read an unverified draft over an existing committed app', async () => {
    const app = [{ path: 'src/App.tsx', content: 'working' }];
    expect(await loadGenerationFiles({ committed: async () => app, checkpoint: async () => { throw new Error('Must not read'); } })).toEqual(app);
  });
  it('does not treat failed reads as permission to build a new app', async () => {
    await expect(loadGenerationFiles({ committed: async () => { throw new Error('offline'); }, checkpoint: async () => [] })).rejects.toThrow('offline');
    await expect(loadGenerationFiles({ committed: async () => [], checkpoint: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
  });
  it('keeps the complete committed tree when a working checkpoint is partial', () => {
    const committed = [
      { path: 'src/App.tsx', content: 'working app' },
      { path: 'src/index.css', content: 'complete design' },
    ];
    const checkpoint = [
      { path: 'src/App.tsx', content: 'unfinished edit' },
      { path: 'src/new.css', content: 'unverified design' },
    ];
    expect(authoritativeProjectFiles(committed, checkpoint)).toEqual(committed);
  });

  it('uses a checkpoint only when the committed file table is empty', () => {
    const checkpoint = [{ path: 'src/App.tsx', content: 'recoverable draft' }];
    expect(authoritativeProjectFiles([], checkpoint)).toEqual(checkpoint);
  });
});
