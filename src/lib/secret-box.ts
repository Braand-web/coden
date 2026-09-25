import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Secrets at rest: AES-256-GCM, sealed with `CODEN_SECRETS_KEY`.
 *
 * Format `v1:<base64(iv ‖ tag ‖ ciphertext)>`. The key is either 32 bytes of
 * base64, or any passphrase, which is stretched with SHA-256. Server-only:
 * nothing here, and nothing it returns, is ever sent to a browser.
 */
const PREFIX = 'v1:';

function keyFrom(secretsKey: string): Buffer {
  const raw = Buffer.from(secretsKey, 'base64');
  if (raw.length === 32 && /^[A-Za-z0-9+/=]+$/.test(secretsKey)) return raw;
  return createHash('sha256').update(secretsKey, 'utf8').digest();
}

export function encryptSecret(plaintext: string, secretsKey: string): string {
  if (!secretsKey) throw new Error('CODEN_SECRETS_KEY is required to encrypt a secret.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secretsKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/** The plaintext, or '' when the value or the key is missing or wrong — never a throw. */
export function decryptSecret(sealed: string | undefined, secretsKey: string | undefined): string {
  if (!sealed || !secretsKey || !sealed.startsWith(PREFIX)) return '';
  try {
    const packed = Buffer.from(sealed.slice(PREFIX.length), 'base64');
    if (packed.length < 29) return '';
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secretsKey), packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    console.error('[coden:secret_decrypt_failed]', { hint: 'A sealed secret does not open with the configured key (CODEN_SECRETS_KEY).' });
    return '';
  }
}
