import { describe, expect, it } from 'vitest';
import { loadLatestDeploymentsByProject } from './dashboard-deployments.ts';

function makeClient(responses: any[]) {
  const projections: string[] = [];
  const client = {
    from(table: string) {
      expect(table).toBe('deployments');
      return {
        select(projection: string) {
          projections.push(projection);
          return {
            in(column: string, ids: string[]) {
              expect(column).toBe('project_id');
              expect(ids).toEqual(['app-a', 'app-b']);
              return {
                order(column: string, options: { ascending: boolean }) {
                  expect(column).toBe('created_at');
                  expect(options).toEqual({ ascending: false });
                  return Promise.resolve(responses.shift());
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, projections };
}

describe('dashboard deployment lookup', () => {
  it('uses the canonical schema and keeps the stable public URL', async () => {
    const { client, projections } = makeClient([
      {
        data: [
          { project_id: 'app-a', status: 'ready', public_url: 'https://app-a.coden.fun' },
          { project_id: 'app-a', status: 'failed', public_url: null },
        ],
        error: null,
      },
    ]);

    const result = await loadLatestDeploymentsByProject(client, ['app-a', 'app-b']);

    expect(projections).toEqual(['project_id,status,public_url,created_at']);
    expect(result.error).toBeNull();
    expect(result.byProject.get('app-a')).toMatchObject({
      status: 'ready',
      public_url: 'https://app-a.coden.fun',
    });
  });

  it('retries a compatible legacy projection when a column is absent', async () => {
    const { client, projections } = makeClient([
      { data: null, error: { code: '42703', message: 'column deployments.public_url does not exist' } },
      {
        data: [{ project_id: 'app-a', deployment_status: 'ready', deployment_url: 'https://legacy.coden.fun' }],
        error: null,
      },
    ]);

    const result = await loadLatestDeploymentsByProject(client, ['app-a', 'app-b']);

    expect(projections).toEqual([
      'project_id,status,public_url,created_at',
      'project_id,deployment_status,deployment_url,created_at',
    ]);
    expect(result.error).toBeNull();
    expect(result.byProject.get('app-a')).toMatchObject({
      deployment_status: 'ready',
      deployment_url: 'https://legacy.coden.fun',
    });
  });

  it('does not retry non-schema errors', async () => {
    const { client, projections } = makeClient([
      { data: null, error: { code: '42501', message: 'permission denied' } },
    ]);

    const result = await loadLatestDeploymentsByProject(client, ['app-a', 'app-b']);

    expect(projections).toHaveLength(1);
    expect(result.error?.code).toBe('42501');
    expect(result.byProject.size).toBe(0);
  });
});
