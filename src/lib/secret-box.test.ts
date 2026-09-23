import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './secret-box';
import { resolveOpenRouterApiKey } from '../services/openrouter-service';

describe('secrets at rest', () => {
  it('round-trips with the right key and opens with no other', () => {
    const sealed = encryptSecret('sk-or-v1-test', 'correct horse battery staple');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain('sk-or');
    expect(decryptSecret(sealed, 'correct horse battery staple')).toBe('sk-or-v1-test');
    expect(decryptSecret(sealed, 'wrong key')).toBe('');
    expect(decryptSecret(sealed, undefined)).toBe('');
  });

  it('prefers the encrypted OpenRouter key over a plain one', () => {
    const sealed = encryptSecret('sk-or-v1-sealed', 'k');
    expect(resolveOpenRouterApiKey({ OPENROUTER_API_KEY_ENCRYPTED: sealed, CODEN_SECRETS_KEY: 'k', OPENROUTER_API_KEY: 'sk-or-v1-plain' })).toBe('sk-or-v1-sealed');
    // A key that does not open falls back to the plain variable rather than to nothing.
    expect(resolveOpenRouterApiKey({ OPENROUTER_API_KEY_ENCRYPTED: sealed, CODEN_SECRETS_KEY: 'x', OPENROUTER_API_KEY: 'sk-or-v1-plain' })).toBe('sk-or-v1-plain');
  });
});
