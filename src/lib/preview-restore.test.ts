import { describe, expect, it, vi } from 'vitest';
import { restoreProjectPreview } from './preview-restore';

const html = '<!doctype html><html><head><style>.app{color:#abc;background:#123}</style></head><body><main class="app">Saved application</main></body></html>';
const makeInput = (status = 'verified') => ({
  html, status, hasFiles: true,
  isUsable: (value: string) => Boolean(value.trim()),
  renderSaved: vi.fn(), resumeLive: vi.fn(async () => false),
  startLive: vi.fn(), showLoading: vi.fn(), isCurrent: vi.fn(() => true),
});

describe('preview restoration after a new Builder document', () => {
  it.each(['verified', 'idle', 'building', 'needs_fix', 'live'])('restores exact HTML and CSS for saved status %s', async status => {
    const input = makeInput(status);
    await restoreProjectPreview(input);
    expect(input.renderSaved).toHaveBeenCalledWith(html, status === 'verified' ? 'verified' : 'needs_fix');
    expect(input.showLoading).not.toHaveBeenCalled();
    expect(input.startLive).toHaveBeenCalledOnce();
  });
  it('paints before a slow status request resolves', async () => {
    let resolve!: (running: boolean) => void;
    const input = makeInput();
    input.resumeLive = vi.fn(() => new Promise<boolean>(done => { resolve = done; }));
    const pending = restoreProjectPreview(input);
    expect(input.renderSaved).toHaveBeenCalledOnce();
    expect(input.startLive).not.toHaveBeenCalled();
    resolve(true);
    await pending;
    expect(input.startLive).not.toHaveBeenCalled();
  });
  it('survives repeated reloads without a live sandbox', async () => {
    for (let reload = 0; reload < 3; reload++) {
      const input = makeInput('idle');
      await restoreProjectPreview(input);
      expect(input.renderSaved.mock.calls[0][0]).toBe(html);
      expect(input.showLoading).not.toHaveBeenCalled();
    }
  });
  it('keeps saved HTML after a failed runtime check', async () => {
    const input = makeInput();
    input.resumeLive.mockRejectedValueOnce(new Error('runtime offline'));
    await restoreProjectPreview(input);
    expect(input.renderSaved).toHaveBeenCalledOnce();
    expect(input.showLoading).not.toHaveBeenCalled();
  });
  it('does not launch an empty project or render a placeholder as the app', async () => {
    const input = { ...makeInput(), html: '', hasFiles: false };
    await restoreProjectPreview(input);
    expect(input.renderSaved).not.toHaveBeenCalled();
    expect(input.showLoading).toHaveBeenCalledOnce();
    expect(input.startLive).not.toHaveBeenCalled();
  });
  it('does not restart a previous project after navigation during its status request', async () => {
    const input = makeInput();
    input.resumeLive.mockImplementationOnce(async () => { input.isCurrent.mockReturnValue(false); return false; });
    await restoreProjectPreview(input);
    expect(input.startLive).not.toHaveBeenCalled();
    expect(input.showLoading).not.toHaveBeenCalled();
  });
});
