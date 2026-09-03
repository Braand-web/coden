/**
 * Every live sandbox on this host, and the limits that keep them from
 * becoming the host's problem.
 *
 * A sandbox is a directory, an npm tree and a running process. Left alone,
 * one per project, they accumulate: a user opens forty projects over a week
 * and forty dev servers are still running, holding memory and ports, long
 * after anyone looked at them. So the registry owns two things the sandbox
 * itself cannot decide -- how many may run at once, and when an idle one
 * stops.
 *
 * Eviction is by least-recently-used, and it stops the process without
 * deleting the directory: coming back to a project should re-start a server
 * over an existing node_modules, not re-install it. That distinction is the
 * difference between resuming in a second and resuming in a minute.
 */

import { ProjectSandbox, type SandboxStatus } from './project-sandbox.ts';

export type RegistryLimits = {
  /** How many dev servers may run at once on this host. */
  maxRunning: number;
  /** How long a sandbox may sit unused before its process is stopped. */
  idleMs: number;
};

export const DEFAULT_LIMITS: RegistryLimits = {
  maxRunning: Number(process.env.CODEN_SANDBOX_MAX_RUNNING || 6),
  idleMs: Number(process.env.CODEN_SANDBOX_IDLE_MS || 15 * 60_000),
};

export class SandboxRegistry {
  private readonly sandboxes = new Map<string, ProjectSandbox>();
  private readonly limits: RegistryLimits;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(limits: Partial<RegistryLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /** The sandbox for this project, created on first use. */
  get(projectId: string): ProjectSandbox {
    const existing = this.sandboxes.get(projectId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }
    const created = new ProjectSandbox(projectId);
    this.sandboxes.set(projectId, created);
    return created;
  }

  peek(projectId: string): ProjectSandbox | null {
    return this.sandboxes.get(projectId) ?? null;
  }

  list(): SandboxStatus[] {
    return [...this.sandboxes.values()].map(sandbox => sandbox.status());
  }

  private running(): ProjectSandbox[] {
    return [...this.sandboxes.values()].filter(sandbox => {
      const state = sandbox.status().state;
      return state === 'running' || state === 'starting';
    });
  }

  /**
   * Make room for one more dev server.
   *
   * Called before a start, not after: going over the limit and then trimming
   * means the moment of peak load is exactly when the host is most loaded.
   */
  async makeRoomFor(projectId: string): Promise<string[]> {
    const evicted: string[] = [];
    let running = this.running().filter(sandbox => sandbox.projectId !== projectId);
    while (running.length >= this.limits.maxRunning) {
      const oldest = running.reduce((a, b) => (a.lastUsedAt <= b.lastUsedAt ? a : b));
      await oldest.stop().catch(() => null);
      evicted.push(oldest.projectId);
      running = running.filter(sandbox => sandbox.projectId !== oldest.projectId);
    }
    return evicted;
  }

  /** Stop the dev servers nobody has used lately. Files are kept. */
  async sweepIdle(now = Date.now()): Promise<string[]> {
    const stopped: string[] = [];
    for (const sandbox of this.running()) {
      if (now - sandbox.lastUsedAt < this.limits.idleMs) continue;
      await sandbox.stop().catch(() => null);
      stopped.push(sandbox.projectId);
    }
    return stopped;
  }

  startSweeper(intervalMs = 60_000): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => { void this.sweepIdle(); }, intervalMs);
    // The sweeper must never be the reason the process stays alive.
    this.sweeper.unref?.();
  }

  stopSweeper(): void {
    if (!this.sweeper) return;
    clearInterval(this.sweeper);
    this.sweeper = null;
  }

  /** Stop every dev server. Used on shutdown so no child outlives the server. */
  async stopAll(): Promise<void> {
    this.stopSweeper();
    await Promise.all([...this.sandboxes.values()].map(sandbox => sandbox.stop().catch(() => null)));
  }

  async destroy(projectId: string): Promise<void> {
    const sandbox = this.sandboxes.get(projectId);
    if (!sandbox) return;
    this.sandboxes.delete(projectId);
    await sandbox.destroy().catch(() => null);
  }
}

/** The host's registry. One per process. */
export const sandboxRegistry = new SandboxRegistry();
