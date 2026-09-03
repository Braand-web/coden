import type { DefinitionOfDoneCriterion } from './contracts.ts';

function criterion(id: string, label: string, required = true): DefinitionOfDoneCriterion {
  return { id, label, required, status: 'pending' };
}

export function buildDefinitionOfDone(input: {
  prompt: string;
  mode: string;
  hasBackend?: boolean;
  hasDatabase?: boolean;
  requiresDeployment?: boolean;
}) {
  if (['ask', 'plan', 'research', 'review'].includes(input.mode)) {
    return [criterion('answer_complete', 'The response directly answers the user request with supported conclusions.')];
  }
  const checks = [
    criterion('requested_behavior', 'The requested user-visible behavior is implemented.'),
    criterion('build', 'The project builds successfully.'),
    criterion('preview', 'The preview starts and renders meaningful content.'),
    criterion('browser_smoke', 'The primary browser journey completes without a blocking error.'),
    criterion('console', 'The primary journey has no blocking console exception.'),
    criterion('responsive', 'The primary interface remains usable on desktop and mobile.'),
  ];
  if (input.hasBackend) checks.push(criterion('backend_health', 'The backend healthcheck and critical API route pass.'));
  if (input.hasDatabase) checks.push(criterion('database', 'Database migrations and access policies are valid.'));
  if (input.requiresDeployment) checks.push(criterion('production', 'The deployed artifact passes its production healthcheck.'));
  return checks;
}
