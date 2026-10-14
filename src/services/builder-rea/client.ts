import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createRequire } from 'node:module';
import path from 'node:path';
import { REA_LIMITS } from './policy.ts';
import type { ReaClient } from './contracts.ts';

let activeSessions = 0;
const require = createRequire(import.meta.url);
export async function connectRea(directory: string, signal?: AbortSignal): Promise<ReaClient> {
  if (activeSessions >= 2) throw new Error('REA_CAPACITY');
  const packageRoot = path.dirname(require.resolve('rea-agents/package.json'));
  const dependencyRoot = path.resolve(packageRoot, '..');
  const slash = (value: string) => value.replaceAll('\\', '/');
  const permissions = ['--permission', '--allow-child-process', '--allow-addons', `--allow-fs-read=${slash(dependencyRoot)}`, `--allow-fs-read=${slash(directory)}`, `--allow-fs-write=${slash(directory)}`];
  const env: Record<string, string> = {
    HOME: directory, USERPROFILE: directory, TMPDIR: directory, TMP: directory, TEMP: directory,
    NODE_OPTIONS: [`--max-old-space-size=${REA_LIMITS.heapMb}`, ...permissions.map(value => value.includes('=') ? value.split('=')[0] + '=' + JSON.stringify(value.slice(value.indexOf('=') + 1)) : value)].join(' '),
    REA_LOG_LEVEL: 'silent',
  };
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR']) if (process.env[key]) env[key] = process.env[key]!;
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(packageRoot, 'scripts/rea.mjs'), 'mcp'], cwd: directory, env, stderr: 'pipe', maxBufferSize: 8 * 1024 * 1024 });
  let filesystemDenied = false;
  transport.stderr?.on('data', (data: Buffer) => {
    // Keep only a classification, never paths or content from child diagnostics.
    if (/ERR_ACCESS_DENIED|permission.*FileSystemRead|Access to this API has been restricted/i.test(data.toString())) filesystemDenied = true;
  });
  const client = new Client({ name: 'coden-builder', version: '1.0.0' });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try { await client.close(); } finally { activeSessions--; }
  };
  // Reserve only after synchronous dependency/transport setup has succeeded.
  activeSessions++;
  try {
    await client.connect(transport, { signal, timeout: 15_000 });
    const version = client.getServerVersion();
    if (version?.name !== 'rea' || version.version !== '6.4.0') throw new Error('REA_VERSION_MISMATCH');
    const catalog = await client.listTools({}, { signal, timeout: 10_000 });
    const allowed = new Set(['analyze_javascript_application', 'inspect_analysis_view', 'trace_application_feature']);
    if ([...allowed].some(name => !catalog.tools.some(tool => tool.name === name))) throw new Error('REA_CONTRACT_UNAVAILABLE');
    return {
      async callTool(input, options) {
        if (closed || !allowed.has(input.name)) throw new Error('REA_TOOL_UNAVAILABLE');
        try { return await client.callTool(input, { signal: options?.signal, timeout: options?.timeout || REA_LIMITS.timeoutMs }); }
        catch (error) { if (filesystemDenied) throw new Error('REA_SCOPE_DENIED'); throw error; }
      },
      close,
    };
  } catch (error) {
    await close().catch(() => {});
    if (filesystemDenied) throw new Error('REA_SCOPE_DENIED');
    throw error;
  }
}
