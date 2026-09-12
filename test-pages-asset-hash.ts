import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { pagesAssetHash } from './src/services/publish-cloudflare.ts';

/*
 * Publishing died on a digest that does not exist.
 *
 * Every deployment through the Pages path threw before it reached Cloudflare:
 *
 *   crypto.createHash('blake2b256' as any)
 *
 * OpenSSL exposes `blake2b512` and `blake2s256` and nothing between them, so
 * Node answered "Digest method not supported" on the first file of every
 * publish. That is the message a user sent from the publish panel, and it is
 * why this account holds 63 projects and zero deployments.
 *
 * The `as any` is how it shipped. TypeScript knew the name was not a digest
 * and was told to stop objecting — the compiler caught this bug before the
 * first user ever did.
 */

/*
 * ONE — the digest that failed really does fail, and the ones near it do not.
 *
 * Asserted rather than assumed: this is the entire bug, and a future Node or
 * OpenSSL that quietly added the name would make the rest of this file
 * meaningless without saying so.
 */
{
  assert.throws(() => createHash('blake2b256'), /not supported/i,
    'blake2b256 is not a Node digest — this is the original failure');
  assert.doesNotThrow(() => createHash('blake2b512'), 'blake2b512 exists, which is what made the typo plausible');
  assert.doesNotThrow(() => createHash('blake2s256'), 'and so does blake2s256');
}

/*
 * TWO — the BLAKE3 implementation is the real one.
 *
 * A hash library is exactly the kind of dependency that must be checked
 * against published vectors rather than trusted, because a wrong one produces
 * confident, well-formed, useless output.
 */
{
  assert.equal(
    bytesToHex(blake3(new TextEncoder().encode(''))),
    'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262',
    'BLAKE3 of the empty input matches the published vector',
  );
  assert.equal(
    bytesToHex(blake3(new TextEncoder().encode('abc'))),
    '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85',
    'BLAKE3 of "abc" matches the published vector',
  );
}

/*
 * THREE — the address is Cloudflare's, in all three of its details.
 *
 * Cloudflare hashes the BASE64 TEXT of the content, with the extension
 * appended and no dot, then keeps the first 32 hex characters. Each of those
 * is a separate way to produce a valid-looking hash that addresses the wrong
 * asset, so each is pinned on its own.
 */
{
  const content = Buffer.from('<!doctype html><title>hi</title>');
  const base64 = content.toString('base64');

  const expected = bytesToHex(blake3(new TextEncoder().encode(base64 + 'html'))).slice(0, 32);
  assert.equal(pagesAssetHash(base64, '/index.html'), expected, 'base64 text, plus extension, truncated to 32');

  // Length: 128 bits of a 256-bit digest. Sending the full digest is a
  // different key space and every upload would miss.
  assert.equal(pagesAssetHash(base64, '/index.html').length, 32, 'exactly 32 hex characters');
  assert.match(pagesAssetHash(base64, '/index.html'), /^[0-9a-f]{32}$/, 'lowercase hex');

  // The extension is part of the address: the same bytes at two extensions
  // are two different assets to Cloudflare.
  assert.notEqual(
    pagesAssetHash(base64, '/index.html'),
    pagesAssetHash(base64, '/index.txt'),
    'the extension changes the address',
  );

  // And the dot is not part of it.
  assert.equal(
    pagesAssetHash(base64, '/a/b/style.css'),
    bytesToHex(blake3(new TextEncoder().encode(base64 + 'css'))).slice(0, 32),
    'the extension is appended without its dot',
  );

  // The content is hashed as base64 text, not as raw bytes. This is the
  // subtle one: hashing the buffer produces a perfectly good hash of the
  // wrong thing.
  assert.notEqual(
    pagesAssetHash(base64, '/index.html'),
    bytesToHex(blake3(content)).slice(0, 32),
    'the base64 text is hashed, not the file bytes',
  );

  // A file with no extension still gets an address.
  assert.match(pagesAssetHash(base64, '/LICENSE'), /^[0-9a-f]{32}$/, 'an extensionless file still hashes');
  // Deeper paths do not leak into the address — only the extension does.
  assert.equal(pagesAssetHash(base64, '/deep/nested/index.html'), pagesAssetHash(base64, '/index.html'),
    'the directory is not part of the content address');
}

/*
 * FOUR — the same content keeps its address, which is what `check-missing` is for.
 *
 * Cloudflare is asked which hashes it already holds and only the rest are
 * uploaded. An address that is not stable between deployments turns that
 * optimisation into a full re-upload every time.
 */
{
  const base64 = Buffer.from('body{color:red}').toString('base64');
  assert.equal(pagesAssetHash(base64, '/app.css'), pagesAssetHash(base64, '/app.css'), 'the address is stable');

  const other = Buffer.from('body{color:blue}').toString('base64');
  assert.notEqual(pagesAssetHash(base64, '/app.css'), pagesAssetHash(other, '/app.css'), 'changed content changes it');
}

/*
 * FIVE — the broken call is gone, and cannot come back through a silenced type.
 */
{
  const source = readFileSync(new URL('./src/services/publish-cloudflare.ts', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '');

  assert.doesNotMatch(code, /createHash\(/, 'no Node digest is used for the Pages asset address');
  assert.doesNotMatch(code, /as any\)/, 'and no cast is silencing the compiler about one');
  assert.match(code, /blake3\(new TextEncoder\(\)\.encode\(base64 \+ extension\)\)/, 'the real address is computed');

  // The manifest and the upload payload must agree on the key, or every
  // uploaded asset lands under an address the deployment never references.
  assert.match(code, /manifest\[rel\] = pagesAssetHash\(base64, rel\);/, 'the manifest records the address');
  assert.match(code, /payloads\[manifest\[rel\]\] = \{/, 'and the payload is filed under that same address');
}

console.log('pages asset hash tests passed');
