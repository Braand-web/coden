// Agent build loop — turns Coden from a one-shot generator into a real agent.
//
// Instead of a single LLM call that must emit the whole project as one JSON
// blob, the agent works in steps with tools: it can read a file before editing
// it, write files one at a time, run a check and SEE the result, then iterate
// until the build is clean. This is the act → observe → iterate loop a proper
// agent builder runs (mirrors the target architecture's ÉTAPE 5).
//
// Composes the already-shipped, tested primitives:
//   • CODEN_AGENT_TOOLS              (tool JSON-schemas)         — agent-tools.ts
//   • runLlmToolLoop                 (tool_call → execute → feed) — llm-tool-loop.ts
//   • buildAutoFixPrompt/parseBuildErrors (turn check output into fixes) — build-error-autofix.ts
//
// Pure & injectable: the gateway, the check runner and the migration runner are
// all injected, so the whole loop is unit-tested with a scripted mock gateway —
// no network, no live LLM.

import { CODEN_AGENT_TOOLS } from './agent-tools.ts';
import { runLlmToolLoop, type LlmToolHandler } from './llm-tool-loop.ts';
import { buildAutoFixPrompt } from './build-error-autofix.ts';

export type AgentWorkspaceFile = { path: string; content: string; language?: string };

export type RunCheckResult = { ok: boolean; output: string };
export type RunCheckFn = (files: AgentWorkspaceFile[], kind: string) => Promise<RunCheckResult> | RunCheckResult;
export type ApplyMigrationFn = (sql: string, allowDestructive: boolean) => Promise<unknown> | unknown;

function normalizePath(p: string): string {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/**
 * Build the tool handlers bound to a live workspace. Each handler returns a
 * compact JSON-able result that gets fed back to the model as the tool message.
 */
export function createAgentToolHandlers(
  workspace: Map<string, AgentWorkspaceFile>,
  opts: { runCheck?: RunCheckFn; applyMigration?: ApplyMigrationFn } = {},
): Record<string, LlmToolHandler> {
  const filesArray = () => Array.from(workspace.values());
  return {
    write_file: (args) => {
      const path = normalizePath(String(args.path || ''));
      if (!path) return { error: 'path is required' };
      const content = typeof args.content === 'string' ? args.content : '';
      const language = typeof args.language === 'string' ? args.language : undefined;
      workspace.set(path, { path, content, language });
      return { ok: true, path, bytes: content.length };
    },
    read_file: (args) => {
      const path = normalizePath(String(args.path || ''));
      const file = workspace.get(path);
      if (!file) return { error: `File not found: ${path}`, exists: false };
      return { path, content: file.content, exists: true };
    },
    run_check: async (args) => {
      const kind = String(args.kind || 'build');
      if (!opts.runCheck) {
        return { ok: true, kind, note: 'No executable check configured in this environment; assuming pass.' };
      }
      const res = await opts.runCheck(filesArray(), kind);
      if (res.ok) return { ok: true, kind };
      // Turn raw compiler output into a structured, surgical fix instruction.
      const fix = buildAutoFixPrompt(res.output);
      return {
        ok: false,
        kind,
        errors: fix.diagnostics.slice(0, 20),
        files_to_fix: fix.files,
        instruction: fix.prompt,
      };
    },
    apply_migration: async (args) => {
      const sql = String(args.sql || '');
      if (!sql.trim()) return { error: 'sql is required' };
      const allowDestructive = Boolean(args.allow_destructive);
      if (!opts.applyMigration) {
        return { ok: false, note: 'Migration recorded but not applied (no migration runner configured).', applied: false };
      }
      try {
        const out = await opts.applyMigration(sql, allowDestructive);
        return { ok: true, applied: true, result: out };
      } catch (error: any) {
        return { ok: false, applied: false, error: String(error?.message || 'apply_migration failed').slice(0, 400) };
      }
    },
  };
}

/** OpenAI/Anthropic-compatible runtime config that advertises the agent tools. */
export function buildAgentToolsRuntimeConfig(adapter: string): any {
  return {
    adapter,
    toolChoice: 'auto',
    tools: CODEN_AGENT_TOOLS.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
  };
}

export type AgentBuildResult = {
  files: AgentWorkspaceFile[];
  summary: string;
  toolExecutions: Array<{ name: string; ok: boolean }>;
  steps: number;
};

/**
 * Run the full agentic build loop. Returns the final workspace files plus a
 * trace of the tool executions. Never the giant-JSON channel — files are
 * produced through write_file tool calls and verified through run_check.
 */
export async function runAgentBuild(input: {
  gateway: any;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  initialFiles?: AgentWorkspaceFile[];
  adapter?: string;
  runtimeConfig?: any;
  maxSteps?: number;
  timeoutMs?: number;
  runCheck?: RunCheckFn;
  applyMigration?: ApplyMigrationFn;
}): Promise<AgentBuildResult> {
  const workspace = new Map<string, AgentWorkspaceFile>(
    (input.initialFiles || []).map(f => [normalizePath(f.path), { ...f, path: normalizePath(f.path) }]),
  );
  const handlers = createAgentToolHandlers(workspace, {
    runCheck: input.runCheck,
    applyMigration: input.applyMigration,
  });
  const runtimeConfig = input.runtimeConfig || buildAgentToolsRuntimeConfig(input.adapter || 'openrouter');

  const loop = await runLlmToolLoop({
    gateway: input.gateway,
    modelId: input.modelId,
    messages: [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: input.userPrompt },
    ],
    handlers,
    runtimeConfig,
    timeoutMs: input.timeoutMs,
    maxSteps: input.maxSteps ?? 6,
  });

  return {
    files: Array.from(workspace.values()),
    summary: String(loop.result.text || 'Agent build complete.'),
    toolExecutions: loop.toolExecutions,
    steps: loop.toolExecutions.length,
  };
}
