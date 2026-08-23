// Structured tool definitions for Coden's generation agent.
//
// Instead of asking the model for one giant JSON blob (which truncates and gets
// dumped into the preview when it breaks), the agent can emit discrete tool
// calls: write_file / read_file / run_check / apply_migration. This module owns
// the tool JSON-schemas (OpenAI/Anthropic compatible) and the parser that turns
// returned tool_calls into concrete generated files + actions.

export type AgentToolName = 'write_file' | 'read_file' | 'run_check' | 'apply_migration';

export type AgentToolDefinition = {
  name: AgentToolName;
  description: string;
  parameters: Record<string, unknown>;
  needsApproval: boolean;
  approvalReason?: string;
};

export const CODEN_AGENT_TOOLS: AgentToolDefinition[] = [
  {
    name: 'write_file',
    description: 'Create or overwrite a project file with full content. Use one call per file. Paths are repo-relative (e.g. src/App.tsx).',
    needsApproval: false,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Repo-relative file path, e.g. src/App.tsx' },
        content: { type: 'string', description: 'Full file content (no truncation, no ellipsis).' },
        language: { type: 'string', description: 'Optional language hint, e.g. tsx, ts, css, json, sql.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read an existing project file before editing it, to avoid clobbering unrelated code.',
    needsApproval: false,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { path: { type: 'string', description: 'Repo-relative file path to read.' } },
      required: ['path'],
    },
  },
  {
    name: 'run_check',
    description: 'Request a verification check on the generated project (typecheck, build, or smoke test).',
    needsApproval: false,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['typecheck', 'build', 'smoke', 'lint'], description: 'Which check to run.' },
      },
      required: ['kind'],
    },
  },
  {
    name: 'apply_migration',
    description: 'Apply a generated SQL migration to the project Supabase backend. Requires explicit user confirmation for destructive statements.',
    needsApproval: true,
    approvalReason: 'Database migrations can change user data or production structure and require explicit approval.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sql: { type: 'string', description: 'Full SQL migration to apply.' },
        allow_destructive: { type: 'boolean', description: 'Must be true to run drop/truncate/delete-without-where.' },
      },
      required: ['sql'],
    },
  },
];

export function getAgentToolDefinition(name: string) {
  return CODEN_AGENT_TOOLS.find(tool => tool.name === name);
}

export function toolNeedsApproval(name: string, args: Record<string, unknown> = {}) {
  const tool = getAgentToolDefinition(name);
  if (!tool?.needsApproval) return false;
  if (name === 'apply_migration') return true;
  if (typeof args.destructive === 'boolean') return args.destructive;
  return true;
}

export type RawToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
  // Anthropic-style:
  name?: string;
  input?: unknown;
};

export type ParsedToolCall =
  | { tool: 'write_file'; path: string; content: string; language?: string }
  | { tool: 'read_file'; path: string }
  | { tool: 'run_check'; kind: string }
  | { tool: 'apply_migration'; sql: string; allow_destructive: boolean }
  | { tool: 'unknown'; name: string; raw: unknown };

function safeParseArgs(call: RawToolCall): any {
  // OpenAI: function.arguments is a JSON string. Anthropic: input is an object.
  if (call.function && typeof call.function.arguments === 'string') {
    try { return JSON.parse(call.function.arguments); } catch { return {}; }
  }
  if (call.input && typeof call.input === 'object') return call.input;
  return {};
}

function toolNameOf(call: RawToolCall): string {
  return String(call.function?.name || call.name || '').trim();
}

export function parseToolCall(call: RawToolCall): ParsedToolCall {
  const name = toolNameOf(call);
  const args = safeParseArgs(call);
  if (name === 'write_file' && typeof args.path === 'string' && typeof args.content === 'string') {
    return { tool: 'write_file', path: args.path, content: args.content, language: typeof args.language === 'string' ? args.language : undefined };
  }
  if (name === 'read_file' && typeof args.path === 'string') {
    return { tool: 'read_file', path: args.path };
  }
  if (name === 'run_check' && typeof args.kind === 'string') {
    return { tool: 'run_check', kind: args.kind };
  }
  if (name === 'apply_migration' && typeof args.sql === 'string') {
    return { tool: 'apply_migration', sql: args.sql, allow_destructive: Boolean(args.allow_destructive) };
  }
  return { tool: 'unknown', name, raw: args };
}

export type GeneratedFileLike = { path: string; content: string; language?: string };

/** Collects every write_file tool call into a deduped file list (last write wins). */
export function parseToolCallsToFiles(calls: RawToolCall[]): GeneratedFileLike[] {
  const byPath = new Map<string, GeneratedFileLike>();
  for (const call of calls || []) {
    const parsed = parseToolCall(call);
    if (parsed.tool === 'write_file' && parsed.path && parsed.content) {
      byPath.set(parsed.path, { path: parsed.path, content: parsed.content, language: parsed.language });
    }
  }
  return Array.from(byPath.values());
}

/** Convenience: are there any actionable write_file calls? */
export function hasFileWrites(calls: RawToolCall[]): boolean {
  return (calls || []).some(call => parseToolCall(call).tool === 'write_file');
}
