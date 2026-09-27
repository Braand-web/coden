import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CODEN_THEME_KEY, getInitialTheme, getSystemTheme } from './theme-controller';

describe('Coden theme preference', () => {
  const getItem = vi.fn<(key: string) => string | null>();
  const matchMedia = vi.fn<(query: string) => { matches: boolean }>();

  beforeEach(() => {
    getItem.mockReset();
    matchMedia.mockReset();
    vi.stubGlobal('localStorage', { getItem });
    vi.stubGlobal('window', { matchMedia });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('follows the system theme when the user has no saved override', () => {
    getItem.mockReturnValue(null);
    matchMedia.mockReturnValue({ matches: true });

    expect(getInitialTheme()).toBe('dark');
    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
  });

  it('preserves an explicit user choice over the system theme', () => {
    getItem.mockImplementation((key) => key === CODEN_THEME_KEY ? 'light' : null);
    matchMedia.mockReturnValue({ matches: true });

    expect(getInitialTheme()).toBe('light');
  });

  it('treats the legacy system value as following the current device theme', () => {
    getItem.mockImplementation((key) => key === CODEN_THEME_KEY ? 'system' : null);
    matchMedia.mockReturnValue({ matches: true });

    expect(getInitialTheme()).toBe('dark');
  });

  it('falls back to light when the device theme API is unavailable', () => {
    vi.stubGlobal('window', {});

    expect(getSystemTheme()).toBe('light');
  });
});
