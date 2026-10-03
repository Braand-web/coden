import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publicCheckoutFailure, publicWebhookFailure } from './billing-failure';

describe('customer-safe billing failures', () => {
  it('never returns provider credentials, database errors or stack traces', () => {
    const result = publicCheckoutFailure(new Error('Bearer sk_live_fixture database password=fixture internal stack'));
    expect(result.status).toBe(503);
    expect(JSON.stringify(result)).not.toMatch(/Bearer|sk_live|password|database|stack/);
  });
  it('distinguishes invalid offers and stale retries from temporary failures', () => {
    expect(publicCheckoutFailure(new Error('Invalid top-up product: fixture')).status).toBe(400);
    expect(publicCheckoutFailure(new Error('This checkout request has already been used. Please try again.')).status).toBe(409);
  });
  it('requests retries on persistence failure, but refuses invalid signatures', () => {
    expect(publicWebhookFailure(new Error('Paid checkout persistence failed.')).status).toBe(503);
    expect(publicWebhookFailure(new Error('Saspay webhook signature validation failed.')).status).toBe(400);
    expect(publicWebhookFailure(new SyntaxError('Invalid JSON')).status).toBe(400);
  });
  it('uses the configured canonical origin, not a caller-supplied host, for payment returns', () => {
    const server = readFileSync('server.ts', 'utf8');
    const checkout = server.slice(server.indexOf('// POST /billing/checkout/subscription'), server.indexOf('// POST /saspay/webhook'));
    expect(checkout.includes("req.get('host')")).toBe(false);
    expect(checkout.match(/getCodenPublicOrigin\(\)/g)?.length).toBe(3);
    expect(checkout.includes('publicCheckoutFailure')).toBe(true);
  });
});
