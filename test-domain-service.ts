import assert from 'node:assert/strict';
import {
  DOMAIN_STATE_LABELS,
  DomainService,
  RESERVED_SUBDOMAINS,
  domainPlanLimits,
  domainStateLabel,
  resolveDomainState,
  sanitizeDomainInput,
  type DomainHostProvider,
  type DomainState,
} from './src/services/domain-service.ts';

/** A host that records what it was asked to do. */
function fakeHost(overrides: Partial<DomainHostProvider> & { hostStatus?: any } = {}) {
  const calls: string[] = [];
  const host: DomainHostProvider = {
    async attach(domain) {
      calls.push(`attach:${domain}`);
      return { instructions: [{ type: 'CNAME', name: domain, value: 'app.workers.dev', status: 'pending' }] };
    },
    async status(domain) {
      calls.push(`status:${domain}`);
      return overrides.hostStatus || { active: false, detail: 'pending', certificate: null };
    },
    async detach(domain) {
      calls.push(`detach:${domain}`);
    },
    ...(overrides as any),
  };
  return { host, calls };
}

/** The smallest Supabase stub the service actually exercises. */
function fakeSupabase(rows: Record<string, any[]> = {}) {
  const writes: any[] = [];
  const store: Record<string, any[]> = { domains: [], dns_verifications: [], ...rows };
  const api = (table: string) => {
    const filters: Array<[string, any]> = [];
    const q: any = {
      select: () => q,
      eq: (field: string, value: any) => { filters.push([field, value]); return q; },
      neq: () => q,
      limit: () => q,
      insert: (values: any[]) => {
        writes.push({ table, op: 'insert', values });
        const row = { id: `${table}-1`, ...values[0] };
        store[table].push(row);
        return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
      },
      update: (patch: any) => { writes.push({ table, op: 'update', patch }); return q; },
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => {
        const match = store[table].find(row => filters.every(([f, v]) => row[f] === v));
        return { data: match || null, error: match ? null : new Error('not found') };
      },
      then: (resolve: any) => resolve({ data: store[table], error: null, count: store[table].length }),
    };
    return q;
  };
  return { client: { from: api }, writes, store };
}

// A domain is registered at the host and recorded, and the DNS instructions the
// user has to enter come back with it.
{
  const { host, calls } = fakeHost();
  const { client, store } = fakeSupabase();
  const service = new DomainService(client, host);
  const created = await service.registerDomain('org-1', 'proj-1', 'App.MonEntreprise.COM', 'custom', 'pro');

  assert.deepEqual(calls, ['attach:app.monentreprise.com'], 'the domain is attached at the host, normalised');
  assert.equal(created.domain, 'app.monentreprise.com');
  assert.equal(created.status, 'pending', 'a custom domain is not active until DNS resolves');
  assert.equal(created.state, 'dns_verification');
  assert.equal(created.dns_records.length, 1);
  assert.equal(created.dns_records[0].type, 'CNAME');
  assert.equal(store.dns_verifications.length, 1, 'the records the user must enter are persisted');
}

// The host is resolved lazily, so an operation that only touches our own
// records neither pays for it nor is blocked by a project with no deployment.
{
  const { client } = fakeSupabase({ domains: [{ id: 'd1', project_id: 'proj-1', domain: 'a.example' }] });
  let resolved = 0;
  const service = new DomainService(client, async () => {
    resolved += 1;
    throw new Error('This project has no published deployment yet');
  });
  await service.setPrimaryDomain('proj-1', 'd1');
  assert.equal(resolved, 0, 'reordering domains must not need the host');
}

// Reserved prefixes and plan limits are enforced before anything is attached.
{
  const { host, calls } = fakeHost();
  const { client } = fakeSupabase();
  const service = new DomainService(client, host);
  await assert.rejects(
    service.registerDomain('org-1', 'proj-1', 'admin.coden.fun', 'subdomain', 'pro'),
    /reserved/i,
  );
  await assert.rejects(
    service.registerDomain('org-1', 'proj-1', 'app.example.com', 'custom', 'free'),
    /allows up to 0 custom domains/i,
  );
  await assert.rejects(service.registerDomain('org-1', 'proj-1', 'not a domain', 'custom', 'pro'), /not a valid domain/i);
  assert.deepEqual(calls, [], 'nothing may reach the host once a rule refuses it');
}

// Verification asks the host and records the answer. Once it is live the domain
// is active and the records read verified.
{
  const { host } = fakeHost({ hostStatus: { active: true, detail: 'active', certificate: 'active' } });
  const { client } = fakeSupabase({
    domains: [{ id: 'd1', project_id: 'proj-1', domain: 'app.example.com', status: 'pending' }],
    dns_verifications: [{ domain_id: 'd1', record_type: 'CNAME', record_name: 'app.example.com', record_value: 'x.workers.dev', status: 'pending' }],
  });
  const result = await new DomainService(client, host).verifyDnsRecords('proj-1', 'd1');
  assert.equal(result.status, 'active');
  assert.equal(result.state, 'active');
  assert.equal(result.error, null);
}

// A host that cannot be reached is an error the user can act on, not a crash.
{
  const { host } = fakeHost({ status: async () => { throw new Error('Cloudflare API unreachable'); } });
  const { client } = fakeSupabase({ domains: [{ id: 'd1', project_id: 'proj-1', domain: 'app.example.com', status: 'pending' }] });
  const result = await new DomainService(client, host).verifyDnsRecords('proj-1', 'd1');
  assert.equal(result.state, 'error');
  assert.match(result.error, /unreachable/i);
}

// Removal must succeed on our side even when the host has already forgotten the
// domain, or the user could never clear a stale record from their interface.
{
  const { host, calls } = fakeHost({ detach: async () => { throw new Error('404 not found'); } });
  const { client, writes } = fakeSupabase({ domains: [{ id: 'd1', project_id: 'proj-1', domain: 'app.example.com' }] });
  await new DomainService(client, host).removeDomain('proj-1', 'd1');
  assert.ok(writes.some(w => w.table === 'domains' && w.patch?.status === 'removed'), 'the record is marked removed');
  assert.deepEqual(calls, [], 'the throwing detach was the override, so nothing was recorded');
}

// The five states the interface shows, each derived from what is actually known.
const stateCases: Array<[string, Parameters<typeof resolveDomainState>[0], DomainState]> = [
  ['no DNS instructions yet', { status: 'pending', hasInstructions: false }, 'configuration_required'],
  ['records given, host has not seen them', { status: 'pending', hasInstructions: true, hostDetail: null }, 'dns_verification'],
  ['host sees them, still spreading', { status: 'pending', hasInstructions: true, hostDetail: 'pending' }, 'dns_propagation'],
  ['live', { status: 'active', hasInstructions: true, hostDetail: 'active' }, 'active'],
  ['host reports a failure', { status: 'pending', hasInstructions: true, hostDetail: 'validation_failed' }, 'error'],
];
for (const [label, input, expected] of stateCases) {
  assert.equal(resolveDomainState(input), expected, `${label} → ${expected}`);
}

// Every state is named in both languages, and the names differ.
for (const state of Object.keys(DOMAIN_STATE_LABELS) as DomainState[]) {
  assert.ok(domainStateLabel(state, 'fr').length > 3, `${state} needs a French label`);
  assert.notEqual(domainStateLabel(state, 'fr'), domainStateLabel(state, 'en'), `${state} must be translated`);
}
assert.equal(domainStateLabel('active'), 'Actif', 'French is the default');

// Input normalisation, since users paste URLs.
assert.equal(sanitizeDomainInput('  HTTPS://App.Example.com/dashboard  '), 'app.example.com');
assert.equal(sanitizeDomainInput('example.com.'), 'example.com');
assert.equal(sanitizeDomainInput(null as any), '');

assert.equal(domainPlanLimits.getCustomDomainLimit('free'), 0);
assert.equal(domainPlanLimits.getCustomDomainLimit('pro'), 1);
assert.ok(RESERVED_SUBDOMAINS.has('admin') && RESERVED_SUBDOMAINS.has('api'));

// Nothing may reintroduce a second hosting provider through this module. Only
// executable lines count — the header explains why Vercel was removed, and that
// prose is the reason a future reader will not put it back.
const source = await import('node:fs').then(fs => fs.readFileSync('src/services/domain-service.ts', 'utf8'));
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(line => !line.trim().startsWith('//'))
  .join('\n');
assert.ok(!/vercel/i.test(code), 'domains are served by Cloudflare only');
assert.ok(/publish-cloudflare/.test(code), 'the provider must come from the Cloudflare publish path');

console.log('domain service tests passed');
