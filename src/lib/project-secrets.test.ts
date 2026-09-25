import { describe, expect, it } from 'vitest';
import { describeServerSecrets, isValidSecretVariable, maskSecretValue, openProjectSecret, projectSecretsKey, publicSecretRow, sealProjectSecret, serverSecretEnv } from './project-secrets';

const KEY = 'test-project-secrets-key';

describe('project secrets', () => {
  it('seals so the server can read the value back, and nothing else can', () => {
    const sealed = sealProjectSecret('re_live_1234567890', KEY);
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain('re_live');
    expect(openProjectSecret(sealed, KEY)).toBe('re_live_1234567890');
    expect(openProjectSecret(sealed, 'another key')).toBe('');
  });

  it('treats values saved as a hash as needing to be entered again', () => {
    const legacy = { id: '1', variable: 'RESEND_API_KEY', encrypted_value: 'sha256:abc:def', masked_value: 're_••••', status: 'configured' };
    expect(openProjectSecret(legacy.encrypted_value, KEY)).toBe('');
    expect(publicSecretRow(legacy)).toMatchObject({ status: 'needs_reentry', masked_value: 're_••••' });
    expect(publicSecretRow(legacy)).not.toHaveProperty('encrypted_value');
  });

  it('gives server code its secrets, never under a VITE_ name', () => {
    const rows = [
      { id: '1', variable: 'STRIPE_SECRET_KEY', encrypted_value: sealProjectSecret('sk_test_x', KEY) },
      { id: '2', variable: 'VITE_LEAKY', encrypted_value: sealProjectSecret('public?', KEY) },
      { id: '3', variable: 'OLD', encrypted_value: 'sha256:a:b' },
    ];
    expect(serverSecretEnv(rows, KEY)).toEqual({ STRIPE_SECRET_KEY: 'sk_test_x' });
    expect(describeServerSecrets(['STRIPE_SECRET_KEY'])).toContain('process.env');
    expect(describeServerSecrets(['STRIPE_SECRET_KEY'])).not.toContain('sk_test_x');
  });

  it('validates names, masks values and prefers a dedicated key', () => {
    expect(isValidSecretVariable('RESEND_API_KEY')).toBe(true);
    expect(isValidSecretVariable('resend')).toBe(false);
    expect(maskSecretValue('abcdefghijkl')).toBe('abcd••••••ijkl');
    expect(projectSecretsKey({ CODEN_SECRETS_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 's' })).toBe('k');
    const derived = projectSecretsKey({ SUPABASE_SERVICE_ROLE_KEY: 's' });
    expect(derived).not.toBe('s');
    expect(derived.length).toBeGreaterThan(20);
    expect(projectSecretsKey({})).toBe('');
  });
});
