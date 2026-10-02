const DEPLOYMENT_PROJECTIONS = [
  'project_id,status,public_url,created_at',
  'project_id,deployment_status,deployment_url,created_at',
  'project_id,status,url,created_at',
  'project_id,deployment_status,public_url,created_at',
] as const;

function isDeploymentSchemaShapeError(error: any) {
  return /schema cache|column .*does not exist|column .* does not exist|could not find .* in the schema cache|Could not find the '([^']+)' column|relation .* does not exist|table .* does not exist/i.test(error?.message || '');
}

/** Loads the newest known deployment row per project across supported schema versions. */
export async function loadLatestDeploymentsByProject(client: any, projectIds: string[]) {
  const byProject = new Map<string, any>();
  if (!projectIds.length) return { byProject, error: null };

  let lastError: any = null;
  for (const projection of DEPLOYMENT_PROJECTIONS) {
    const result = await client
      .from('deployments')
      .select(projection)
      .in('project_id', projectIds)
      .order('created_at', { ascending: false });

    if (result.error) {
      lastError = result.error;
      if (isDeploymentSchemaShapeError(result.error)) continue;
      return { byProject, error: result.error };
    }

    for (const deployment of result.data || []) {
      if (deployment?.project_id && !byProject.has(deployment.project_id)) {
        byProject.set(deployment.project_id, deployment);
      }
    }
    return { byProject, error: null };
  }

  return { byProject, error: lastError };
}
