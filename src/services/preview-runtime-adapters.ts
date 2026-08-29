import {
  detectProjectRuntime,
  validateProjectManifest,
  type CodenProjectManifest,
  type CodenRuntime,
  type ManifestFile,
  type RuntimeDetection,
} from './universal-project-manifest';

export type PreviewCommandResult = { exitCode: number; stdout: string; stderr: string; durationMs: number; processId?: string };
export type PreviewHealthResult = { ready: boolean; status?: number; url?: string; reason?: string; meaningfulContent?: boolean };
export type PreviewSession = {
  id: string;
  files: ManifestFile[];
  manifest: CodenProjectManifest;
  env: Record<string, string>;
  ports: number[];
  processes: string[];
  executor: {
    run(command: string, options: { env: Record<string, string>; timeoutMs: number; background?: boolean }): Promise<PreviewCommandResult>;
    healthcheck(path: string, port: number, timeoutMs: number): Promise<PreviewHealthResult>;
    stop(processId: string): Promise<void>;
  };
};
export type AdapterValidation = { valid: boolean; errors: string[]; warnings: string[] };
export type PreviewStepResult = { ok: boolean; skipped?: boolean; command?: string; result?: PreviewCommandResult; error?: string };
export type StartResult = PreviewStepResult & { ports: number[]; processIds: string[] };

export interface PreviewRuntimeAdapter {
  readonly runtime: CodenRuntime;
  detect(files: ManifestFile[]): RuntimeDetection;
  validate(manifest: CodenProjectManifest): AdapterValidation;
  install(session: PreviewSession): Promise<PreviewStepResult>;
  build(session: PreviewSession): Promise<PreviewStepResult>;
  start(session: PreviewSession): Promise<StartResult>;
  healthcheck(session: PreviewSession): Promise<PreviewHealthResult>;
  stop(session: PreviewSession): Promise<void>;
}

const SAFE_COMMAND = /^(true|static-preview|npm|pnpm|yarn|npx|node)\b/;

abstract class CommandPreviewAdapter implements PreviewRuntimeAdapter {
  abstract readonly runtime: CodenRuntime;
  detect(files: ManifestFile[]) { return detectProjectRuntime(files); }
  validate(manifest: CodenProjectManifest): AdapterValidation {
    const base = validateProjectManifest(manifest);
    const errors = [...base.errors];
    if (manifest.runtime !== this.runtime) errors.push(`adapter ${this.runtime} cannot run manifest ${manifest.runtime}`);
    for (const command of Object.values(manifest.commands)) {
      if (command && !SAFE_COMMAND.test(command.trim())) errors.push(`command is not allowed in preview sandbox: ${command}`);
    }
    return { valid: errors.length === 0, errors, warnings: base.warnings };
  }
  protected async execute(session: PreviewSession, command: string | undefined, timeoutMs: number, background = false): Promise<PreviewStepResult> {
    if (!command || command === 'true') return { ok: true, skipped: true };
    if (!SAFE_COMMAND.test(command.trim())) return { ok: false, command, error: 'Command is blocked by preview policy.' };
    const result = await session.executor.run(command, { env: session.env, timeoutMs, background });
    if (result.processId) session.processes.push(result.processId);
    return { ok: result.exitCode === 0, command, result, error: result.exitCode === 0 ? undefined : result.stderr || `Command exited with ${result.exitCode}` };
  }
  install(session: PreviewSession) { return this.execute(session, session.manifest.commands.install, 180_000); }
  build(session: PreviewSession) { return this.execute(session, session.manifest.commands.build, 180_000); }
  async start(session: PreviewSession): Promise<StartResult> {
    const command = session.manifest.commands.start || session.manifest.commands.dev;
    const step = await this.execute(session, command, 30_000, true);
    const port = session.manifest.preview.port;
    if (port && !session.ports.includes(port)) session.ports.push(port);
    return { ...step, ports: [...session.ports], processIds: [...session.processes] };
  }
  async healthcheck(session: PreviewSession) {
    const port = session.manifest.preview.port || session.ports[0];
    if (!port) return { ready: false, reason: 'No preview port was declared or detected.' };
    const result = await session.executor.healthcheck(session.manifest.preview.healthPath, port, 20_000);
    if (result.ready && result.meaningfulContent === false) return { ...result, ready: false, reason: 'Preview returned an empty or non-meaningful document.' };
    return result;
  }
  async stop(session: PreviewSession) {
    await Promise.allSettled(session.processes.map((processId) => session.executor.stop(processId)));
    session.processes.splice(0);
  }
}

export class StaticPreviewAdapter extends CommandPreviewAdapter {
  readonly runtime = 'static' as const;
  override async install() { return { ok: true, skipped: true }; }
  override async build() { return { ok: true, skipped: true }; }
}
export class VitePreviewAdapter extends CommandPreviewAdapter { readonly runtime = 'vite' as const; }
export class NodePreviewAdapter extends CommandPreviewAdapter { readonly runtime = 'node' as const; }
export class NextPreviewAdapter extends CommandPreviewAdapter { readonly runtime = 'next' as const; }
export class CloudflareWorkerPreviewAdapter extends CommandPreviewAdapter { readonly runtime = 'cloudflare-worker' as const; }

export class FullstackPreviewAdapter extends CommandPreviewAdapter {
  readonly runtime = 'fullstack' as const;
  override async start(session: PreviewSession): Promise<StartResult> {
    const frontend = await this.execute(session, session.manifest.commands.dev, 30_000, true);
    if (!frontend.ok) return { ...frontend, ports: [...session.ports], processIds: [...session.processes] };
    const backendCommand = session.manifest.commands.start;
    if (backendCommand && backendCommand !== session.manifest.commands.dev) {
      const backend = await this.execute(session, backendCommand, 30_000, true);
      if (!backend.ok) return { ...backend, ports: [...session.ports], processIds: [...session.processes] };
    }
    if (session.manifest.preview.port && !session.ports.includes(session.manifest.preview.port)) session.ports.push(session.manifest.preview.port);
    return { ok: true, ports: [...session.ports], processIds: [...session.processes] };
  }
}

const ADAPTERS: Record<CodenRuntime, PreviewRuntimeAdapter> = {
  static: new StaticPreviewAdapter(),
  vite: new VitePreviewAdapter(),
  node: new NodePreviewAdapter(),
  next: new NextPreviewAdapter(),
  'cloudflare-worker': new CloudflareWorkerPreviewAdapter(),
  fullstack: new FullstackPreviewAdapter(),
};

export function resolvePreviewRuntimeAdapter(manifest: CodenProjectManifest) {
  const adapter = ADAPTERS[manifest.runtime];
  const validation = adapter.validate(manifest);
  if (!validation.valid) throw new Error(`Invalid preview manifest: ${validation.errors.join('; ')}`);
  return adapter;
}

export async function runUniversalPreviewPipeline(session: PreviewSession) {
  const adapter = resolvePreviewRuntimeAdapter(session.manifest);
  const install = await adapter.install(session);
  if (!install.ok) return { status: 'failed' as const, stage: 'install' as const, install };
  if (session.manifest.commands.typecheck) {
    const typecheck = await session.executor.run(session.manifest.commands.typecheck, { env: session.env, timeoutMs: 120_000 });
    if (typecheck.exitCode !== 0) return { status: 'failed' as const, stage: 'typecheck' as const, install, typecheck };
  }
  const build = await adapter.build(session);
  if (!build.ok) return { status: 'failed' as const, stage: 'build' as const, install, build };
  const start = await adapter.start(session);
  if (!start.ok) return { status: 'failed' as const, stage: 'start' as const, install, build, start };
  const health = await adapter.healthcheck(session);
  if (!health.ready) return { status: 'failed' as const, stage: 'healthcheck' as const, install, build, start, health };
  return { status: 'ready' as const, stage: 'ready' as const, install, build, start, health };
}
