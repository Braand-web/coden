import { describe, expect, it } from 'vitest';
import { shouldRetainPreview } from './preview-retention';

describe('preview retention during cancellation and replacement', () => {
  it('retains a live app without a saved HTML rendering', () => {
    expect(shouldRetainPreview({ usableHtml: false, liveUrl: '/preview/app/', browserRuntimeUrl: '' })).toBe(true);
  });
  it('retains saved HTML and browser-hosted runtimes', () => {
    expect(shouldRetainPreview({ usableHtml: true, liveUrl: '', browserRuntimeUrl: '' })).toBe(true);
    expect(shouldRetainPreview({ usableHtml: false, liveUrl: '', browserRuntimeUrl: 'https://runtime.test' })).toBe(true);
  });
  it('permits an idle placeholder only when no application exists', () => {
    expect(shouldRetainPreview({ usableHtml: false, liveUrl: '', browserRuntimeUrl: '' })).toBe(false);
  });
});
