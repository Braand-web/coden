import assert from 'node:assert/strict';
import { containsSecret, redactSecretPayload, redactSecrets } from './src/services/secret-redaction.ts';

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
