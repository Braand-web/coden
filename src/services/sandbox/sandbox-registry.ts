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

import os from 'node:os';
import fs from 'node:fs';
import { ProjectSandbox, type SandboxStatus } from './project-sandbox.ts';

export type RegistryLimits = {
  /** How many dev servers may run at once on this host. */
  maxRunning: number;
  /** How long a sandbox may sit unused before its process is stopped. */
  idleMs: number;
};

/**
 * How many dev servers this host can actually hold.
 *
 * Derived rather than constant, because the number that is safe is a property
 * of the machine and not of the code. A Vite dev server settles around 250 MB
 * and an npm install peaks higher, so a fixed default of six is fine on a
 * workstation and takes down a 1 GB container — where the failure is not a
 * slow preview but the whole API being OOM-killed.
 *
 * Half the memory is left to the server itself and to install peaks, and the
 * result is clamped to at least one: a host too small for two sandboxes can
 * still run one, and refusing to run any would be a worse answer than running
 * them one at a time.
 */
const MB_PER_SANDBOX = 350;

/**
 * The memory this process may actually use.
 *
 * `os.totalmem()` reports the machine, not the container: on a 1 GB Railway
 * service it answers with the host's 16 GB, and a limit derived from it is a
 * safeguard that reads correctly and protects nothing. The cgroup file is the
 * real ceiling, so it is asked first and the machine is only the fallback for
 * hosts that are not containers.
 *
 * An unset cgroup limit is written as a number near 2^63, so anything at or
 * above the machine's own memory is treated as "no limit set".
 */
export function availableMemoryBytes(): number {
  const machine = os.totalmem();
  for (const file of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const raw = fs.readFileSync(file, 'utf8').trim();
      if (raw === 'max') continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0 && value < machine) return value;
    } catch { /* not a container, or a kernel that does not expose it */ }
  }
  return machine;
}

export function defaultMaxRunning(totalBytes = availableMemoryBytes()): number {
  const budgetMb = (totalBytes / (1024 * 1024)) * 0.5;
  return Math.max(1, Math.min(6, Math.floor(budgetMb / MB_PER_SANDBOX)));
}

export const DEFAULT_LIMITS: RegistryLimits = {
  maxRunning: Number(process.env.CODEN_SANDBOX_MAX_RUNNING) || defaultMaxRunning(),
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
