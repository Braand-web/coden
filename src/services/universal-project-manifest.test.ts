import { describe, expect, it, vi } from 'vitest';
import { createProjectManifest, detectProjectRuntime, validateProjectManifest } from './universal-project-manifest';
import { runUniversalPreviewPipeline, type PreviewSession } from './preview-runtime-adapters';
import { immutableArtifactHash, selectDeploymentTarget, validateDeploymentGate } from './deployment-adapters';

const viteFiles = [
  { path: 'package.json', content: JSON.stringify({ scripts: { dev: 'vite', build: 'vite build', typecheck: 'tsc --noEmit' }, dependencies: { react: '^19.0.0' }, devDependencies: { vite: '^6.0.0' } }) },
  { path: 'package-lock.json', content: '{}' },
  { path: 'index.html', content: '<main>Coden preview</main>' },
];

describe('universal project manifest', () => {
  it('detects Vite and creates a valid deployable contract', () => {
    const detected = detectProjectRuntime(viteFiles);
    expect(detected).toMatchObject({ runtime: 'vite', framework: 'react', packageManager: 'npm' });
    const manifest = createProjectManifest({ projectId: 'project_1', name: 'CRM', files: viteFiles });
    expect(validateProjectManifest(manifest)).toEqual({ valid: true, errors: [], warnings: [] });
    expect(manifest.deployment.target).toBe('cloudflare');
  });

  it('rejects dangerous commands and public-prefixed secrets', () => {
    const manifest = createProjectManifest({ projectId: 'project_1', name: 'CRM', files: viteFiles });
    manifest.commands.build = 'sudo rm -rf /';
    manifest.environment.push({ name: 'VITE_SECRET_KEY', required: true, secret: true, scope: 'both', description: 'bad secret scope' });
    const result = validateProjectManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('blocked system operation');
    expect(result.warnings.join(' ')).toContain('public-client prefix');
  });

  it('runs install, typecheck, build, start and a meaningful healthcheck in order', async () => {
    const manifest = createProjectManifest({ projectId: 'project_1', name: 'CRM', files: viteFiles });
    const run = vi.fn(async (command: string, options: { background?: boolean }) => ({ exitCode: 0, stdout: command, stderr: '', durationMs: 5, processId: options.background ? 'process_1' : undefined }));
    const healthcheck = vi.fn(async () => ({ ready: true, status: 200, url: 'https://preview.local', meaningfulContent: true }));
    const session: PreviewSession = {
      id: 'preview_1',
      files: viteFiles,
      manifest,
      env: {},
      ports: [],
      processes: [],
      executor: { run, healthcheck, stop: vi.fn(async () => undefined) },
    };
    const result = await runUniversalPreviewPipeline(session);
    expect(result.status).toBe('ready');
    expect(run.mock.calls.map((call) => call[0])).toEqual(['npm ci', 'npm run typecheck', 'npm run build', 'npm run dev']);
    expect(healthcheck).toHaveBeenCalledOnce();
  });

  it('blocks deployment without confirmation or verified evidence and hashes immutable content', () => {
    const manifest = createProjectManifest({ projectId: 'project_1', name: 'CRM', files: viteFiles });
    const artifact = { files: [{ path: 'index.html', content: '<h1>CRM</h1>' }], manifest, previewSessionId: 'preview_1', verificationPassed: true, securityBlockers: [] };
    const hash = immutableArtifactHash(artifact);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(selectDeploymentTarget(manifest)).toBe('cloudflare');
    expect(validateDeploymentGate({ projectId: 'project_1', artifact, environment: {}, confirmed: false }).valid).toBe(false);
    expect(validateDeploymentGate({ projectId: 'project_1', artifact, environment: {}, confirmed: true }).valid).toBe(true);
  });
});
