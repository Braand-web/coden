import { createHash } from 'node:crypto';
import type { CodenProjectManifest, CodenDeploymentTarget } from './universal-project-manifest';

export type VerifiedArtifact = {
  files: Array<{ path: string; content: string }>;
  manifest: CodenProjectManifest;
  previewSessionId: string;
  verificationPassed: boolean;
  securityBlockers: string[];
};
export type DeploymentInput = {
  projectId: string;
  artifact: VerifiedArtifact;
  environment: Record<string, string>;
  confirmed: boolean;
  domain?: string;
};
export type DeploymentValidation = { valid: boolean; errors: string[]; artifactHash: string };
export type DeploymentResult = { deploymentId: string; target: CodenDeploymentTarget; url: string; artifactHash: string; rollbackAvailable: boolean };
export type DeploymentHealth = { ready: boolean; status?: number; reason?: string };
export type RollbackResult = { success: boolean; deploymentId: string };

export interface DeploymentAdapter {
  readonly target: CodenDeploymentTarget;
  supports(manifest: CodenProjectManifest): boolean;
  validate(input: DeploymentInput): Promise<DeploymentValidation>;
  deploy(input: DeploymentInput): Promise<DeploymentResult>;
  healthcheck(result: DeploymentResult): Promise<DeploymentHealth>;
  rollback(deploymentId: string): Promise<RollbackResult>;
}

export function immutableArtifactHash(artifact: VerifiedArtifact) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({
    manifest: artifact.manifest,
    files: [...artifact.files].sort((a, b) => a.path.localeCompare(b.path)).map((file) => [file.path, file.content]),
  }));
  return `sha256:${hash.digest('hex')}`;
}

export function validateDeploymentGate(input: DeploymentInput): DeploymentValidation {
  const errors: string[] = [];
  const artifactHash = immutableArtifactHash(input.artifact);
  if (!input.confirmed) errors.push('explicit user confirmation is required');
  if (!input.artifact.verificationPassed) errors.push('the preview artifact is not verified');
  if (input.artifact.securityBlockers.length) errors.push('security blockers must be resolved');
  for (const requirement of input.artifact.manifest.environment) {
    if (requirement.required && !String(input.environment[requirement.name] || '').trim()) errors.push(`missing required environment variable: ${requirement.name}`);
  }
  if (input.domain && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(input.domain)) errors.push('domain is invalid');
  return { valid: errors.length === 0, errors, artifactHash };
}

type PlatformClient = {
  deploy(input: { projectId: string; artifact: VerifiedArtifact; artifactHash: string; environment: Record<string, string>; domain?: string }): Promise<{ deploymentId: string; url: string }>;
  healthcheck(url: string): Promise<DeploymentHealth>;
  rollback(deploymentId: string): Promise<RollbackResult>;
};

abstract class PlatformDeploymentAdapter implements DeploymentAdapter {
  abstract readonly target: CodenDeploymentTarget;
  constructor(protected readonly client: PlatformClient) {}
  abstract supports(manifest: CodenProjectManifest): boolean;
  async validate(input: DeploymentInput) {
    const gate = validateDeploymentGate(input);
    if (input.artifact.manifest.deployment.target !== this.target && !(this.target === 'cloudflare' && input.artifact.manifest.deployment.target === 'static')) gate.errors.push(`manifest target is not compatible with ${this.target}`);
    gate.valid = gate.errors.length === 0;
    return gate;
  }
  async deploy(input: DeploymentInput) {
    const validation = await this.validate(input);
    if (!validation.valid) throw new Error(`Deployment blocked: ${validation.errors.join('; ')}`);
    const deployed = await this.client.deploy({ projectId: input.projectId, artifact: input.artifact, artifactHash: validation.artifactHash, environment: input.environment, domain: input.domain });
    return { ...deployed, target: this.target, artifactHash: validation.artifactHash, rollbackAvailable: true };
  }
  healthcheck(result: DeploymentResult) { return this.client.healthcheck(result.url); }
  rollback(deploymentId: string) { return this.client.rollback(deploymentId); }
}

export class CloudflareDeploymentAdapter extends PlatformDeploymentAdapter {
  readonly target = 'cloudflare' as const;
  supports(manifest: CodenProjectManifest) { return manifest.runtime === 'static' || manifest.runtime === 'vite' || manifest.runtime === 'cloudflare-worker'; }
}
export class RailwayDeploymentAdapter extends PlatformDeploymentAdapter {
  readonly target = 'railway' as const;
  supports(manifest: CodenProjectManifest) { return manifest.runtime === 'node' || manifest.runtime === 'next' || manifest.runtime === 'fullstack'; }
}

export function selectDeploymentTarget(manifest: CodenProjectManifest): CodenDeploymentTarget {
  if (manifest.deployment.target !== 'external') return manifest.deployment.target;
  if (manifest.runtime === 'static' || manifest.runtime === 'vite' || manifest.runtime === 'cloudflare-worker') return 'cloudflare';
  if (manifest.runtime === 'node' || manifest.runtime === 'next' || manifest.runtime === 'fullstack') return 'railway';
  return 'external';
}
