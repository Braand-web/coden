import { describe, expect, it } from 'vitest';
import { blockedByProviderLogin } from './publish-vercel.ts';

describe('a preview that Vercel keeps behind a login', () => {
  it('is recognised when every check was answered with 401 or a login redirect', () => {
    expect(blockedByProviderLogin([{ status: 401, error: 'HTTP 401' }, { status: 401, error: 'HTTP 401' }])).toBe(true);
    expect(blockedByProviderLogin([{ status: 200, error: 'VERCEL_LOGIN_REDIRECT' }])).toBe(true);
  });

  it('is not mistaken for a broken site', () => {
    expect(blockedByProviderLogin([])).toBe(false);
    expect(blockedByProviderLogin([{ status: 404, error: 'HTTP 404' }])).toBe(false);
    expect(blockedByProviderLogin([{ status: 401, error: 'HTTP 401' }, { status: 200 }])).toBe(false);
    expect(blockedByProviderLogin([{ status: 0, error: 'timeout' }])).toBe(false);
  });
});
