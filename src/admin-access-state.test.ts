import { describe, expect, it } from 'vitest';
import { adminLoadFailureCopy, classifyAdminLoadFailure } from './admin-access-state';

describe('admin data access state', () => {
  it('identifies the server-side platform-admin gate', () => {
    expect(classifyAdminLoadFailure({ success: false, http_status: 403, diagnostic_code: 'ADMIN_ACCESS_REQUIRED' })).toBe('forbidden');
  });

  it('does not treat successful empty data as an access failure', () => {
    expect(classifyAdminLoadFailure({ success: true, http_status: 200 })).toBeNull();
  });

  it('keeps unavailable data distinct from real zero-valued metrics', () => {
    expect(classifyAdminLoadFailure({ success: false, http_status: 503, error: 'Backend indisponible' })).toBe('unavailable');
    expect(adminLoadFailureCopy('unavailable', 'Backend indisponible').message).toContain('pas remplacés par des zéros fictifs');
  });
});
