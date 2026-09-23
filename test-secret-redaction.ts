import assert from 'node:assert/strict';
import { containsSecret, createStreamingRedactor, redactSecretPayload, redactSecrets } from './src/services/secret-redaction.ts';

function base64UrlJson(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value))
    .toString('base64url');
}

const fakeServiceRoleJwt = [
  base64UrlJson({ alg: 'HS256', typ: 'JWT' }),
  base64UrlJson({
    iss: 'supabase',
    ref: 'testprojectref',
    role: 'service_role',
    iat: 1,
    exp: 9999999999,
  }),
  'fake-signature-value-for-tests',
].join('.');

assert.equal(containsSecret(fakeServiceRoleJwt), true);
assert.equal(redactSecrets(fakeServiceRoleJwt), '[masked-secret]');
assert.equal(redactSecrets('const form = { password: values.password };'), 'const form = { password: values.password };');

const redactedAssignment = redactSecrets(`SUPABASE_SERVICE_ROLE_KEY=${fakeServiceRoleJwt}`);
assert.ok(redactedAssignment.includes('[masked-secret]'));
assert.ok(!redactedAssignment.includes(fakeServiceRoleJwt));

const payload = redactSecretPayload({
  content: `never show ${fakeServiceRoleJwt}`,
  nested: {
    token: 'sbp_fake_personal_token_123',
    safe: 'regular text',
  },
});

const json = JSON.stringify(payload);
assert.ok(!json.includes(fakeServiceRoleJwt));
assert.ok(!json.includes('sbp_fake_personal_token_123'));
assert.ok(json.includes('regular text'));

console.log('test-secret-redaction passed');

// A streamed answer is redacted as it is written, even when a key is split
// across deltas, and the pieces add up to exactly the redacted whole.
{
  const answer = `Voici la config : token: ${'a1B2c3D4'.repeat(4)} et la clé sk-proj-${'Z9y8X7w6'.repeat(3)} fin.\nAussi ${fakeServiceRoleJwt} ici.`;
  for (const size of [1, 3, 7, 40]) {
    let out = '';
    const redactor = createStreamingRedactor(delta => { out += delta; });
    for (let index = 0; index < answer.length; index += size) {
      redactor.push(answer.slice(index, index + size));
      assert.ok(!out.includes('sk-proj-Z9'), `split key leaked at delta size ${size}`);
      assert.ok(!out.includes('a1B2c3D4a1B2'), `assigned token leaked at delta size ${size}`);
      assert.ok(!out.includes(fakeServiceRoleJwt.slice(0, 40)), `jwt leaked at delta size ${size}`);
    }
    redactor.end();
    assert.equal(out, redactSecrets(answer));
  }
}
