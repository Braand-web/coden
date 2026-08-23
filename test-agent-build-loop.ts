import assert from 'node:assert/strict';
import {
  runAgentBuild,
  createAgentToolHandlers,
  buildAgentToolsRuntimeConfig,
  type AgentWorkspaceFile,
} from './src/services/agent-build-loop.ts';

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return { id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } };
}

// ── Handlers (unit) ─────────────────────────────────────────────────────────
{
  const ws = new Map<string, AgentWorkspaceFile>();
  const h = createAgentToolHandlers(ws);
  assert.deepEqual(await h.write_file({ path: 'src/App.tsx', content: 'x', language: 'tsx' }), { ok: true, path: 'src/App.tsx', bytes: 1 });
  assert.equal(ws.get('src/App.tsx')?.content, 'x');
  assert.deepEqual(await h.read_file({ path: 'src/App.tsx' }), { path: 'src/App.tsx', content: 'x', exists: true });
  assert.equal((await h.read_file({ path: 'nope.ts' }) as any).exists, false);
  // run_check with no runner → assumed pass
  assert.equal((await h.run_check({ kind: 'build' }) as any).ok, true);
  // apply_migration with no runner → recorded, not applied
  assert.equal((await h.apply_migration({ sql: 'create table x()' }) as any).applied, false);
}

// run_check returns structured fix instructions when the check fails.
{
  const ws = new Map<string, AgentWorkspaceFile>([['src/App.tsx', { path: 'src/App.tsx', content: 'bad' }]]);
  const h = createAgentToolHandlers(ws, {
    runCheck: () => ({ ok: false, output: "src/App.tsx(3,5): error TS2304: Cannot find name 'foo'." }),
  });
  const res = await h.run_check({ kind: 'typecheck' }) as any;
  assert.equal(res.ok, false);
  assert.deepEqual(res.files_to_fix, ['src/App.tsx']);
  assert.match(res.instruction, /Edit only these files/);
}

// runtime config advertises the 4 agent tools.
{
  const cfg = buildAgentToolsRuntimeConfig('anthropic');
  assert.equal(cfg.tools.length, 4);
  assert.deepEqual(cfg.tools.map((t: any) => t.function.name).sort(), ['apply_migration', 'read_file', 'run_check', 'write_file']);
}

// ── Full agentic loop: write → check fails → fix → check passes → done ───────
{
  let step = 0;
  const gateway = {
    async chat(_modelId: string, _messages: any[], _opts: any) {
      step += 1;
      if (step === 1) {
        return {
          text: 'Creating the app.',
          tool_calls: [
            toolCall('c1', 'write_file', { path: 'src/App.tsx', content: 'export default () => <Broken/>' }),
            toolCall('c2', 'run_check', { kind: 'build' }),
          ],
          model: 'mock', usage: {}, cost_usd: 0,
        };
      }
      if (step === 2) {
        // The model observed the failing check and fixes the file.
        return {
          text: 'Fixing the build error.',
          tool_calls: [
            toolCall('c3', 'write_file', { path: 'src/App.tsx', content: 'export default () => null /* fixed */' }),
            toolCall('c4', 'run_check', { kind: 'build' }),
          ],
          model: 'mock', usage: {}, cost_usd: 0,
        };
      }
      // No more tool calls → loop ends.
      return { text: 'Done. The app builds cleanly.', model: 'mock', usage: {}, cost_usd: 0 };
    },
  };

  const runCheck = (files: AgentWorkspaceFile[]) => {
    const app = files.find(f => f.path === 'src/App.tsx');
    const fixed = app?.content.includes('fixed');
    return fixed
      ? { ok: true, output: '' }
      : { ok: false, output: "src/App.tsx(1,30): error TS2304: Cannot find name 'Broken'." };
  };

  const result = await runAgentBuild({
    gateway,
    modelId: 'mock',
    systemPrompt: 'You are Coden.',
    userPrompt: 'Build an app.',
    runCheck,
    maxSteps: 6,
  });

  // The final workspace has the FIXED file (agent iterated on the check result).
  assert.equal(result.files.length, 1);
  assert.match(result.files[0].content, /fixed/);
  // It ran multiple tool steps (write + check + write + check).
  assert.ok(result.toolExecutions.length >= 4, `expected >=4 tool execs, got ${result.toolExecutions.length}`);
  assert.ok(result.toolExecutions.some(t => t.name === 'run_check'));
  assert.ok(result.toolExecutions.some(t => t.name === 'write_file'));
  assert.match(result.summary, /Done/);
  assert.equal(step, 3, 'loop ran exactly 3 model turns then stopped');
}

console.log('test-agent-build-loop passed');
