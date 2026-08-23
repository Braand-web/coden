import assert from 'node:assert/strict';
import {
  VercelDomainService,
  buildDnsRecordInstructionsFromVercel,
} from './src/services/domain-service.ts';

type FetchCall = {
  url: string;
  method: string;
  body?: string;
  authorization?: string | null;
};

const originalFetch = globalThis.fetch;
const calls: FetchCall[] = [];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = String(init?.method || 'GET');
  const headers = new Headers(init?.headers || {});
  calls.push({
    url,
    method,
    body: typeof init?.body === 'string' ? init.body : undefined,
    authorization: headers.get('authorization'),
  });

  if (url.includes('/v10/projects/proj_123/domains')) {
    return new Response(JSON.stringify({
      id: 'dom_real_123',
      name: 'example.com',
      verified: false,
      verification: [
        { type: 'TXT', domain: '_vercel-challenge.example.com', value: 'real-vercel-token' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (url.includes('/v10/projects/proj_existing/domains')) {
    return new Response(JSON.stringify({
      error: { message: 'Domain already exists in this project' },
    }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  if (url.includes('/v2/deployments/dpl_123/aliases')) {
    return new Response(JSON.stringify({
      alias: 'example.com',
      deploymentId: 'dpl_123',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (url.includes('/verify') && url.includes('not-ready.com')) {
    return new Response(JSON.stringify({
      verified: false,
      verification: [
        { type: 'TXT', domain: '_vercel-challenge.not-ready.com', value: 'pending-token' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (url.includes('/verify') && url.includes('bad-token.com')) {
    return new Response(JSON.stringify({ error: { message: 'Invalid token' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (method === 'DELETE') {
    return new Response(null, { status: 204 });
  }

  return new Response(JSON.stringify({ error: { message: `Unexpected ${method} ${url}` } }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof fetch;

try {
  const service = new VercelDomainService('vc_test_token', 'team_123');
  const added = await service.addDomainToVercel('proj_123', 'example.com');
  assert.equal(added.vercel_domain_id, 'dom_real_123');
  assert.equal(added.verification_token, 'real-vercel-token');
  assert.equal(added.verified, false);
  assert.equal(added.verification.length, 1);
  assert.equal(calls[0].url, 'https://api.vercel.com/v10/projects/proj_123/domains?teamId=team_123');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].authorization, 'Bearer vc_test_token');
  assert.deepEqual(JSON.parse(calls[0].body || '{}'), { name: 'example.com' });

  const existing = await service.ensureDomainOnProject('proj_existing', 'example.com');
  assert.equal(existing.vercel_domain_id, 'example.com');
  assert.equal(existing.verified, true);

  const alias = await service.assignDeploymentAlias('dpl_123', 'example.com');
  assert.equal(alias.alias, 'example.com');
  assert.equal(alias.deployment_id, 'dpl_123');
  assert.ok(calls.some(call => call.url === 'https://api.vercel.com/v2/deployments/dpl_123/aliases?teamId=team_123' && call.method === 'POST'));
  const aliasCall = calls.find(call => call.url === 'https://api.vercel.com/v2/deployments/dpl_123/aliases?teamId=team_123' && call.method === 'POST');
  assert.deepEqual(JSON.parse(aliasCall?.body || '{}'), { alias: 'example.com' });

  const pending = await service.verifyVercelDomain('proj_123', 'not-ready.com');
  assert.equal(pending.verified, false);
  assert.equal(pending.verification?.[0]?.value, 'pending-token');
  assert.ok(calls.some(call => call.url === 'https://api.vercel.com/v9/projects/proj_123/domains/not-ready.com/verify?teamId=team_123' && call.method === 'POST'));

  const failed = await service.verifyVercelDomain('proj_123', 'bad-token.com');
  assert.equal(failed.verified, false);
  assert.equal(failed.error, 'Invalid token');

  await service.removeDomainFromVercel('proj_123', 'example.com');
  assert.ok(calls.some(call => call.url === 'https://api.vercel.com/v9/projects/proj_123/domains/example.com?teamId=team_123' && call.method === 'DELETE'));

  const apexRecords = buildDnsRecordInstructionsFromVercel('example.com', [
    { type: 'TXT', domain: '_vercel-challenge.example.com', value: 'real-token' },
  ]);
  assert.deepEqual(apexRecords.map(record => `${record.type}:${record.name}:${record.value}`), [
    'TXT:_vercel-challenge.example.com:real-token',
    'A:@:76.76.21.21',
  ]);

  const subdomainRecords = buildDnsRecordInstructionsFromVercel('app.example.com', []);
  assert.deepEqual(subdomainRecords.map(record => `${record.type}:${record.name}:${record.value}`), [
    'CNAME:app:cname.vercel-dns.com',
  ]);

  console.log('domain-service tests passed');
} finally {
  globalThis.fetch = originalFetch;
}
