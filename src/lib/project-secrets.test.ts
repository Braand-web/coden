import { describe, expect, it } from 'vitest';
import { createSecretRedactor, describeServerSecrets, isValidSecretVariable, maskSecretValue, normalizeStoredMask, openProjectSecret, projectSecretsKey, publicSecretRow, sealProjectSecret, serverSecretEnv } from './project-secrets';

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
    expect(publicSecretRow(legacy)).toMatchObject({ status: 'needs_reentry', masked_value: '••••••••' });
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
    expect(maskSecretValue('abcdefghijkl')).toBe('••••••••');
    expect(maskSecretValue('re_live_0123456789abcdefWXYZ')).toBe('••••••••WXYZ');
    expect(normalizeStoredMask('re_l••••••4f2a')).toBe('••••••••4f2a');
    expect(normalizeStoredMask('••••')).toBe('••••••••');
    expect(isValidSecretVariable('NODE_OPTIONS')).toBe(false);
    expect(isValidSecretVariable('LD_PRELOAD')).toBe(false);
    expect(isValidSecretVariable('CODEN_SECRETS_KEY')).toBe(false);
    expect(isValidSecretVariable('VITE_API_KEY')).toBe(false);
    expect(projectSecretsKey({ CODEN_SECRETS_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 's' })).toBe('k');
    const derived = projectSecretsKey({ SUPABASE_SERVICE_ROLE_KEY: 's' });
    expect(derived).not.toBe('s');
    expect(derived.length).toBeGreaterThan(20);
    expect(projectSecretsKey({})).toBe('');
  });

  it('keeps values sealed with the derived key readable after CODEN_SECRETS_KEY is set', () => {
    const derived = projectSecretsKey({ SUPABASE_SERVICE_ROLE_KEY: 'service' });
    const sealed = sealProjectSecret('sk_test_before_rotation', derived);
    expect(openProjectSecret(sealed, 'new-dedicated-key', derived)).toBe('sk_test_before_rotation');
    expect(openProjectSecret(sealed, 'new-dedicated-key', '')).toBe('');
  });

  it('never lets a secret value reach the model through a tool result', () => {
    const redact = createSecretRedactor({ STRIPE_SECRET_KEY: 'sk_test_ab"cd\\ef', SHORT: 'abc' })!;
    const raw = 'STRIPE_SECRET_KEY=sk_test_ab"cd\\ef\nSHORT=abc';
    expect(redact(raw)).toBe('STRIPE_SECRET_KEY=[secret:STRIPE_SECRET_KEY]\nSHORT=abc');
    expect(redact(JSON.stringify({ stdout: raw }))).not.toContain('sk_test_ab');
    expect(createSecretRedactor({})).toBeUndefined();
  });
});
