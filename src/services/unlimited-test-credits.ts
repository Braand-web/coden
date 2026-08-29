import { createHash } from 'node:crypto';

const DEFAULT_AUTHORIZED_EMAIL_HASHES = new Set([
  // User-authorized Coden beta account. The email itself is intentionally not
  // stored in source control; authentication is still required before activation.
  '4077cc876e507c7dc108e07c387bbae79788f576cdced5209643b6e5638f5747',
]);

export const UNLIMITED_TEST_CREDIT_DISPLAY_BALANCE = 1_000_000_000;
export const UNLIMITED_TEST_CREDIT_METADATA_KEY = 'coden_test_credit_unlimited';

export function normalizedEmailHash(email: unknown) {
  return createHash('sha256')
    .update(String(email || '').trim().toLowerCase(), 'utf8')
    .digest('hex');
}

export function getAuthorizedUnlimitedTestEmailHashes(env: Record<string, string | undefined> = process.env) {
  const configured = String(env.CODEN_UNLIMITED_TEST_EMAIL_HASHES || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(value => /^[a-f0-9]{64}$/.test(value));
  return new Set([...DEFAULT_AUTHORIZED_EMAIL_HASHES, ...configured]);
}

export function canActivateUnlimitedTestCredits(
  email: unknown,
  env: Record<string, string | undefined> = process.env,
) {
  return getAuthorizedUnlimitedTestEmailHashes(env).has(normalizedEmailHash(email));
}

export function userHasUnlimitedTestCredits(user: any) {
  return user?.app_metadata?.[UNLIMITED_TEST_CREDIT_METADATA_KEY] === true;
}

