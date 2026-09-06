import { describe, expect, it } from 'vitest';
import { requireDatabaseResult } from './database-result.ts';

describe('Supabase result handling', () => {
  it('accepts query builders without a catch method', async () => {
    const builder = { then: Promise.resolve({ data: 'saved', error: null }).then.bind(Promise.resolve({ data: 'saved', error: null })) };
    expect('catch' in builder).toBe(false);
    await expect(requireDatabaseResult(builder, 'test')).resolves.toBe('saved');
  });
  it('rejects resolved SQL errors without exposing the SQL details', async () => {
    await expect(requireDatabaseResult(Promise.resolve({ error: { code: '42501', message: 'private row contents' } }), 'save deployment'))
      .rejects.toMatchObject({ message: 'Database operation failed: save deployment.', code: '42501' });
  });
  it('propagates transport failures', async () => {
    await expect(requireDatabaseResult(Promise.reject(new Error('offline')), 'save')).rejects.toThrow('offline');
  });
});
