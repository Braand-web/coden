import { describe, expect, it } from 'vitest';
import {
  getRequestClientIp,
  isTemporaryGenerationAccessAllowed,
  isTemporaryGenerationRoute,
  normalizeIpAddress,
  readTemporaryGenerationAccessConfig,
} from './temporary-generation-access';

const future = '2099-01-01T00:00:00.000Z';

describe('temporary generation access', () => {
  it('normalizes mapped IPv4 addresses and loopback', () => {
    expect(normalizeIpAddress('::ffff:129.0.204.175')).toBe('129.0.204.175');
    expect(normalizeIpAddress('::1')).toBe('127.0.0.1');
  });

  it('fails closed unless access, IP, email, and expiry are configured', () => {
    const env = {
      CODEN_TEMPORARY_GENERATION_ACCESS: '1',
      CODEN_TEMPORARY_GENERATION_IPS: '129.0.204.175',
      CODEN_TEMPORARY_GENERATION_EMAIL: 'tester@example.com',
      CODEN_TEMPORARY_GENERATION_EXPIRES_AT: future,
    };
    expect(isTemporaryGenerationAccessAllowed({ ip: '129.0.204.175' }, env, Date.parse('2026-08-30T00:00:00.000Z'))).toBe(true);
    expect(isTemporaryGenerationAccessAllowed({ ip: '203.0.113.10' }, env, Date.parse('2026-08-30T00:00:00.000Z'))).toBe(false);
    expect(isTemporaryGenerationAccessAllowed({ ip: '129.0.204.175' }, { ...env, CODEN_TEMPORARY_GENERATION_EXPIRES_AT: '' }, Date.parse('2026-08-30T00:00:00.000Z'))).toBe(false);
  });

  it('uses the forwarded client IP only when explicitly trusted', () => {
    const request = { ip: '10.0.0.1', headers: { 'x-forwarded-for': '129.0.204.175, 10.0.0.2' } };
    expect(getRequestClientIp(request, false)).toBe('10.0.0.1');
    expect(getRequestClientIp(request, true)).toBe('129.0.204.175');
  });

  it('allows only generation-related project routes for the temporary principal', () => {
    expect(isTemporaryGenerationRoute('POST', '/api/projects')).toBe(true);
    expect(isTemporaryGenerationRoute('POST', '/api/projects/project-1/generate')).toBe(true);
    expect(isTemporaryGenerationRoute('POST', '/api/projects/project-1/publish')).toBe(false);
    expect(isTemporaryGenerationRoute('DELETE', '/api/projects/project-1')).toBe(false);
    expect(isTemporaryGenerationRoute('GET', '/api/projects/project-1/agent/runs/run-1')).toBe(true);
    expect(isTemporaryGenerationRoute('POST', '/api/projects/project-1/versions/version-1/rollback')).toBe(false);
  });

  it('deduplicates configured IPs and normalizes email', () => {
    const config = readTemporaryGenerationAccessConfig({
      CODEN_TEMPORARY_GENERATION_ACCESS: 'true',
      CODEN_TEMPORARY_GENERATION_IPS: '::ffff:127.0.0.1,127.0.0.1',
      CODEN_TEMPORARY_GENERATION_EMAIL: '  Tester@Example.com ',
      CODEN_TEMPORARY_GENERATION_EXPIRES_AT: future,
    });
    expect(config.ips).toEqual(['127.0.0.1']);
    expect(config.email).toBe('tester@example.com');
  });
});
