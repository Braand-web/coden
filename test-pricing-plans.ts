import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { priceFor, publicBillingCatalog } from './src/config/billing-v2.ts';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const routePolicy = JSON.parse(read('config/public-route-policy.json')) as {
  canonicalPublic: string[];
  redirects: Record<string, string>;
};
const pricingHtml = read('pricing.html');
const smokeCheck = read('scripts/production-smoke-check.cjs');
const server = read('server.ts');

assert(routePolicy.canonicalPublic.includes('/pricing.html'), 'Pricing must be an indexed public route.');
assert.equal(routePolicy.redirects['/pricing'], '/pricing.html', 'The short pricing URL must redirect to the canonical page.');
assert.match(pricingHtml, /<h1[^>]*>Transformez votre idée en application web\./, 'Pricing requires a visible page title aligned with Coden positioning.');
assert.match(pricingHtml, /data-pricing-tier="pro"/, 'Pro requires a credit tier selector.');
assert.match(pricingHtml, /data-pricing-tier="business"/, 'Business requires a credit tier selector.');
assert.match(pricingHtml, /src="\/src\/pricing-page\.ts"/, 'Pricing requires the dynamic catalog adapter.');
assert.match(smokeCheck, /['"]\/pricing\.html['"]/, 'Production smoke checks must include the pricing page.');
assert.match(smokeCheck, /['"]\/pricing['"]/, 'Production smoke checks must include the short pricing redirect.');
assert.match(server, /function requireBillingAuth[\s\S]*?req\.method === 'GET' && req\.path === '\/plans'/, 'Only the public pricing catalog may bypass billing authentication.');
assert.match(server, /app\.use\('\/api\/billing', requireBillingAuth\)/, 'All other billing routes must remain authenticated.');

assert.equal(priceFor('pro', 100, 'monthly').amountUsd, 25, 'Pro 100 monthly must match the public V2 price.');
assert.equal(priceFor('business', 100, 'monthly').amountUsd, 50, 'Business 100 monthly must match the public V2 price.');
assert.equal(priceFor('pro', 100, 'annual').amountUsd, 240, 'Annual pricing must apply the published discount.');

const catalog = publicBillingCatalog();
assert.equal(catalog.plans.length, 3, 'The public catalog must expose Free, Pro and Business.');
assert.equal(catalog.provider, 'saspay', 'Saspay must be the public billing provider.');
assert.equal(catalog.currency, 'xaf', 'The public catalog must settle in XAF.');
assert(catalog.prices.some(price => price.plan === 'pro' && price.credits === 100 && price.interval === 'monthly' && price.amount === 15_000), 'The public Pro entry price must be 15 000 XAF.');
assert(catalog.prices.some(price => price.plan === 'pro' && price.credits === 10_000), 'The public catalog must expose the highest Pro tier.');
assert(catalog.prices.some(price => price.plan === 'business' && price.credits === 10_000), 'The public catalog must expose the highest Business tier.');

console.log('pricing plan contract passed');
