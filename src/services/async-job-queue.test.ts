import { afterEach, describe, expect, it } from 'vitest';
import { enqueueJob, initJobQueue } from './async-job-queue.ts';

const input = { type: 'generate' as const, project_id: 'project', user_id: 'user', organization_id: 'org', payload: {} };
afterEach(() => initJobQueue(null));
describe('durable job acknowledgement', () => {
  it('does not acknowledge an insertion rejected by the database', async () => {
    initJobQueue({ from: () => ({ insert: () => Promise.resolve({ error: { code: '42501' } }) }) });
    await expect(enqueueJob(input)).rejects.toThrow('enqueue job');
  });
  it('accepts an actual PromiseLike insert without catch()', async () => {
    const saved = Promise.resolve({ error: null });
    initJobQueue({ from: () => ({ insert: () => ({ then: saved.then.bind(saved) }) }) });
    await expect(enqueueJob(input)).resolves.toMatch(/^job_/);
  });
});
