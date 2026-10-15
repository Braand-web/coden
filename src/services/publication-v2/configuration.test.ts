import { describe, expect, it } from 'vitest';
import { publicationConfigurationChecks } from './configuration.ts';
const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'private-provider-token', CLOUDFLARE_WORKERS_SUBDOMAIN: 'coden-staging', CODEN_PUBLICATION_PLATFORM_SECRET: 's'.repeat(48), E2B_API_KEY: 'private-build-token' };
const options = { platformOrigin: 'https://staging.example.com', rootDomain: 'apps.example.com' };
describe('Publication production configuration', () => {
  it('requires explicit valid configuration without leaking credentials', () => {
    const missing = publicationConfigurationChecks({}, options);
    expect(missing.filter(c => c.status === 'fail').map(c => c.id)).toEqual(['workers_account', 'workers_token', 'workers_subdomain', 'workers_secret']);
    const valid = publicationConfigurationChecks(env, options);
    expect(valid.every(c => c.status === 'pass')).toBe(true);
    expect(JSON.stringify(valid)).not.toContain(env.CLOUDFLARE_API_TOKEN);
    expect(JSON.stringify(valid)).not.toContain(env.CODEN_PUBLICATION_PLATFORM_SECRET);
  });
  it('requires an isolated builder only for projects that execute build scripts', () => {
    expect(publicationConfigurationChecks({ ...env, E2B_API_KEY: '' }, options).every(c => c.status === 'pass')).toBe(true);
    expect(publicationConfigurationChecks({ ...env, CODEN_SANDBOX_PROVIDER: 'local' }, { ...options, requiresBuild: true }).at(-1)?.status).toBe('fail');
    expect(publicationConfigurationChecks(env, { ...options, requiresBuild: true }).at(-1)?.status).toBe('pass');
  });
  it.each(['http://staging.example.com', 'https://user:password@staging.example.com', 'https://staging.example.com/path', 'https://localhost'])('refuses unsafe platform origin %s', platformOrigin => {
    expect(publicationConfigurationChecks(env, { ...options, platformOrigin }).find(c => c.id === 'publication_origin')?.status).toBe('fail');
  });
});
