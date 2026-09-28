import { describe, expect, it } from 'vitest';
import { authoritativeProjectFiles } from './project-file-recovery.ts';

describe('project file recovery', () => {
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
