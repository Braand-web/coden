import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('static source build', () => {
  it('installs devDependencies even though the build runs with NODE_ENV=production', () => {
    const source = readFileSync(new URL('./build-runner.ts', import.meta.url), 'utf8');
    const install = source.split('\n').find(line => line.includes("run('npm', ['install'"));
    expect(install).toBeDefined();
    expect(install).toContain('--include=dev');
  });
});
