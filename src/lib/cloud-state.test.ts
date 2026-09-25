import { describe, expect, it } from 'vitest';
import { detectBackendNeedsFromFiles, provisionReasonText, resolveCloudState } from './cloud-state';

describe('Coden Cloud state', () => {
  it('never answers "not detected": each state explains itself', () => {
    expect(resolveCloudState({ status: 'planned', needs: { needs_database: true, needs_auth: true, needs_storage: false } })).toMatchObject({ state: 'required', action: 'provision', label: 'À activer' });
    expect(resolveCloudState({ status: null, needs: null })).toMatchObject({ state: 'not_needed', action: 'provision' });
    expect(resolveCloudState({ status: 'active', hasSupabaseUrl: true })).toMatchObject({ state: 'connected', action: null });
    expect(resolveCloudState({ status: 'provisioning' }).state).toBe('provisioning');
    const failed = resolveCloudState({ status: 'failed', lastError: 'quota_reached' });
    expect(failed).toMatchObject({ state: 'failed', action: 'retry' });
    expect(failed.explanation).toContain('quota');
    expect(failed.explanation).toContain('administrateur');
  });

  it('does not offer an action that cannot work', () => {
    const view = resolveCloudState({ status: 'planned', needs: { needs_database: true }, provisioningAvailable: false });
    expect(view.action).toBeNull();
    expect(view.explanation).toContain('pas configurée');
  });

  it('reads the need for a backend from the files that were built', () => {
    expect(detectBackendNeedsFromFiles([{ path: 'src/pages/Home.tsx', content: 'export default () => <h1>Salut</h1>' }])).toEqual({ needs_database: false, needs_auth: false, needs_storage: false });
    expect(detectBackendNeedsFromFiles([{ path: 'supabase/schema.sql', content: 'create table public.todos (id uuid primary key);' }]).needs_database).toBe(true);
    const auth = detectBackendNeedsFromFiles([{ path: 'src/lib/auth.ts', content: 'await supabase.auth.signInWithPassword({ email, password })' }]);
    expect(auth).toMatchObject({ needs_auth: true, needs_database: true });
    expect(detectBackendNeedsFromFiles([{ path: 'src/upload.ts', content: 'supabase.storage.from("avatars")' }]).needs_storage).toBe(true);
  });

  it('turns reason codes into sentences, never raw provider text', () => {
    expect(provisionReasonText('invalid_token_format')).toContain('sbp_');
    expect(provisionReasonText('something 500 {"message":"secret"}')).toBe(provisionReasonText('provider_error'));
  });
});
