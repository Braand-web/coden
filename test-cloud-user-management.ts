// Unit tests for the end-user management security logic (pure, no I/O).
// Most important guard: safeUserFields() never leaks sensitive fields
// (password hashes, tokens, identities) from a raw Supabase user.

import assert from 'node:assert/strict';
import {
  isValidEmail,
  sanitizeAppRole,
  safeUserFields,
  SAFE_USER_KEYS,
  requireConfirmation,
  requireDeleteConfirmation,
  sanitizeUsersPerPage,
  MAX_USERS_PAGE,
} from './src/services/cloud-user-management.ts';

// ── Email validation ─────────────────────────────────────────────────────────
{
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('user.name+tag@example.com'), true);
  for (const bad of ['', 'nope', 'a@b', 'a b@c.com', 'a@b .com', 'x'.repeat(260) + '@y.com', 'a@@b.com', 'a@b.', 'no-at-sign.com']) {
    assert.equal(isValidEmail(bad), false, `reject email ${JSON.stringify(bad)}`);
  }
}

// ── Role allow-list: no privilege escalation ─────────────────────────────────
{
  assert.equal(sanitizeAppRole('admin'), 'admin');
  assert.equal(sanitizeAppRole('USER'), 'user');
  for (const bad of ['service_role', 'supabase_admin', 'postgres', 'platform_admin', 'root', 'superuser', '', 'owner']) {
    assert.equal(sanitizeAppRole(bad), null, `reject role ${bad}`);
  }
}

// ── safeUserFields NEVER leaks sensitive data ─────────────────────────────────
{
  const raw = {
    id: 'u1',
    email: 'end@user.com',
    created_at: '2026-01-01T00:00:00Z',
    last_sign_in_at: '2026-06-01T00:00:00Z',
    email_confirmed_at: '2026-01-02T00:00:00Z',
    banned_until: null,
    app_metadata: { role: 'member', provider: 'email' },
    user_metadata: { role: 'editor' },
    // Sensitive fields that MUST NOT appear in the output:
    encrypted_password: '$2a$10$hashhashhash',
    password: 'plaintext',
    confirmation_token: 'ctok',
    recovery_token: 'rtok',
    email_change_token_new: 'etok',
    phone: '+15555555555',
    identities: [{ id: 'idp', identity_data: { sub: 'x' }, access_token: 'AAA', refresh_token: 'BBB' }],
    factors: [{ secret: 'TOTPSECRET' }],
  };
  const safe = safeUserFields(raw);

  // Only whitelisted keys are present.
  assert.deepEqual(Object.keys(safe).sort(), [...SAFE_USER_KEYS].sort(), 'only safe keys present');

  // Spot-check the values.
  assert.equal(safe.id, 'u1');
  assert.equal(safe.email, 'end@user.com');
  assert.equal(safe.confirmed, true);
  assert.equal(safe.banned, false);
  assert.equal(safe.role, 'member', 'app_metadata role wins, within allow-list');

  // Serialize and assert NONE of the sensitive material is reachable.
  const serialized = JSON.stringify(safe);
  for (const secret of ['hashhash', 'plaintext', 'ctok', 'rtok', 'etok', 'AAA', 'BBB', 'TOTPSECRET', '+15555555555', 'encrypted_password', 'identities', 'factors']) {
    assert.equal(serialized.includes(secret), false, `serialized safe user must not contain ${secret}`);
  }
}

// Banned detection (future date) and unknown role fall-through.
{
  const banned = safeUserFields({ id: 'u2', banned_until: new Date(Date.now() + 3600_000).toISOString(), app_metadata: { role: 'service_role' } });
  assert.equal(banned.banned, true, 'future banned_until => banned');
  assert.equal(banned.role, null, 'illegal role stripped to null');
  const past = safeUserFields({ id: 'u3', banned_until: '2000-01-01T00:00:00Z' });
  assert.equal(past.banned, false, 'past banned_until => not banned');
}

// ── Confirmation guards ───────────────────────────────────────────────────────
{
  assert.equal(requireConfirmation({}).ok, false, 'no confirm => blocked');
  assert.equal(requireConfirmation({ confirm: false }).ok, false);
  assert.equal(requireConfirmation({ confirm: true }).ok, true);

  // Deletion needs confirm AND the exact echoed email.
  assert.equal(requireDeleteConfirmation({ confirm: true }, 'a@b.com').ok, false, 'delete without echo email blocked');
  assert.equal(requireDeleteConfirmation({ confirm: true, confirm_email: 'WRONG@b.com' }, 'a@b.com').ok, false, 'wrong echo blocked');
  assert.equal(requireDeleteConfirmation({ confirm: true, confirm_email: 'A@B.com' }, 'a@b.com').ok, true, 'correct echo (case-insensitive) ok');
  assert.equal(requireDeleteConfirmation({ confirm: false, confirm_email: 'a@b.com' }, 'a@b.com').ok, false, 'needs confirm flag too');
}

// ── Pagination bound ──────────────────────────────────────────────────────────
{
  assert.equal(sanitizeUsersPerPage(9999), MAX_USERS_PAGE);
  assert.equal(sanitizeUsersPerPage(0), 50);
  assert.equal(sanitizeUsersPerPage(20), 20);
}

console.log('test-cloud-user-management: all assertions passed');
