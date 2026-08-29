import { describe, expect, it } from 'vitest';
import {
  canActivateUnlimitedTestCredits,
  normalizedEmailHash,
  userHasUnlimitedTestCredits,
} from './unlimited-test-credits';

describe('unlimited beta test credit entitlement', () => {
  it('normalizes email hashes deterministically', () => {
    expect(normalizedEmailHash('  TEST@Example.COM ')).toBe(normalizedEmailHash('test@example.com'));
  });

  it('accepts configured hashes and rejects unrelated accounts', () => {
    const authorized = normalizedEmailHash('beta@example.com');
    const env = { CODEN_UNLIMITED_TEST_EMAIL_HASHES: authorized };
    expect(canActivateUnlimitedTestCredits('beta@example.com', env)).toBe(true);
    expect(canActivateUnlimitedTestCredits('other@example.com', env)).toBe(false);
  });

  it('trusts only server-owned app metadata', () => {
    expect(userHasUnlimitedTestCredits({ app_metadata: { coden_test_credit_unlimited: true } })).toBe(true);
    expect(userHasUnlimitedTestCredits({ user_metadata: { coden_test_credit_unlimited: true } })).toBe(false);
  });
});

