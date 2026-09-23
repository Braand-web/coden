/**
 * Seal a secret for storage in the environment.
 *
 *   CODEN_SECRETS_KEY=… npx tsx scripts/encrypt-secret.ts < key.txt
 *
 * Prints `v1:…`, the value for OPENROUTER_API_KEY_ENCRYPTED. Reads stdin so
 * the plaintext never lands in shell history.
 */
import { encryptSecret } from '../src/lib/secret-box.ts';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const plaintext = Buffer.concat(chunks).toString('utf8').trim();
if (!plaintext) {
  console.error('Pipe the secret on stdin.');
  process.exit(1);
}
process.stdout.write(`${encryptSecret(plaintext, process.env.CODEN_SECRETS_KEY || '')}\n`);
