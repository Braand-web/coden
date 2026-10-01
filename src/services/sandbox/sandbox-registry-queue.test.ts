import { describe, expect, it } from 'vitest';
import { SandboxRegistry, defaultMaxRuns } from './sandbox-registry';

describe('waiting for an execution slot', () => {
  it('lets the second build wait for the first instead of failing at once', async () => {
    const registry = new SandboxRegistry({ maxRunning: 1 });
    const first = await registry.acquireRun('a');
    let second: (() => void) | null = null;
    const pending = registry.acquireRun('b', { waitMs: 5_000 }).then(release => { second = release; });
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(second).toBeNull();
    first();
    await pending;
    expect(second).not.toBeNull();
    second!();
  });

  it('fails with the capacity error only once the wait is over', async () => {
    const registry = new SandboxRegistry({ maxRunning: 1 });
    const first = await registry.acquireRun('a');
    const started = Date.now();
    await expect(registry.acquireRun('b', { waitMs: 400 })).rejects.toMatchObject({ diagnosticCode: 'SANDBOX_CAPACITY' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
    first();
  });

  it('still refuses at once a second run for the same project', async () => {
    const registry = new SandboxRegistry({ maxRunning: 3 });
    await registry.acquireRun('a');
    await expect(registry.acquireRun('a', { waitMs: 5_000 })).rejects.toMatchObject({ diagnosticCode: 'PROJECT_RUN_ACTIVE' });
  });

  it('stops waiting when the request is cancelled', async () => {
    const registry = new SandboxRegistry({ maxRunning: 1 });
    await registry.acquireRun('a');
    const controller = new AbortController();
    const waiting = registry.acquireRun('b', { signal: controller.signal, waitMs: 5_000 });
    setTimeout(() => controller.abort(), 100);
    await expect(waiting).rejects.toBeTruthy();
  });
});

describe('how many runs a host allows', () => {
  const GB = 1024 ** 3;
  it('keeps the memory-derived cap for local dev servers', () => {
    expect(defaultMaxRuns({}, GB)).toBe(1);
  });
  it('does not tie remote (E2B) builds to the orchestrator’s memory', () => {
    expect(defaultMaxRuns({ E2B_API_KEY: 'k' }, GB)).toBe(8);
    expect(defaultMaxRuns({ E2B_API_KEY: 'k', CODEN_SANDBOX_MAX_REMOTE_RUNS: '3' }, GB)).toBe(3);
    expect(defaultMaxRuns({ E2B_API_KEY: 'k', CODEN_SANDBOX_PROVIDER: 'local' }, GB)).toBe(1);
  });
  it('an explicit setting always wins', () => {
    expect(defaultMaxRuns({ CODEN_SANDBOX_MAX_RUNNING: '4', E2B_API_KEY: 'k' }, GB)).toBe(4);
  });
});
