/**
 * Naming the sandbox's concrete tools in the harness's vocabulary.
 *
 * The harness has a complete apparatus for recording what an agent does —
 * `startTool` opens a `tool_call` item, claims the files it will write,
 * charges the turn's budget and emits an event; `completeTool` and `failTool`
 * close it. None of it has ever run. Production holds 112 `user_message`
 * items, 56 `assistant_message`, 37 `subagent` and 36 `verification` — and
 * zero `tool_call`, ever. The harness knows a subagent ran; it has never known
 * what the subagent did.
 *
 * What kept them apart is that they speak different languages. The sandbox
 * offers `read_file`, `write_file`, `install_package`. The harness reasons
 * about `workspace.read`, `workspace.patch`, `shell.exec` — categories that
 * carry risk, roles and approval. Wiring them directly would have thrown
 * `Unknown harness tool: read_file` on the first call of every run.
 *
 * The translation is not plumbing. It is what lets the harness know a write is
 * a write: `workspace.patch` claims the file it touches, so two agents cannot
 * edit it at once, and `database.migrate` demands an approval that
 * `read_file` never will.
 */

import type { HarnessAgentRole } from './contracts.ts';

/** The harness tool a sandbox tool acts as, or null when it has no equivalent. */
export function harnessToolForSandboxTool(name: string): string | null {
  switch (name) {
    case 'read_file':
    case 'list_files':
      return 'workspace.read';
    case 'search_files':
      return 'workspace.search';
    case 'write_file':
    case 'edit_file':
    case 'delete_file':
      return 'workspace.patch';
    case 'run_command':
    case 'install_package':
    case 'restart_server':
      return 'shell.exec';
    case 'get_logs':
      return 'browser.inspect';
    default:
      // An unmapped tool is recorded as nothing rather than guessed into a
      // category: calling a write a read would defeat the locking this exists
      // for, and `shell.exec` is not a safe default for something unknown.
      return null;
  }
}

/**
 * What this call will touch, for the harness to lock.
 *
 * Only writes claim anything. A read that claimed its file would block the
 * write that follows it — and reading before writing is the behaviour worth
 * encouraging, not penalising.
 */
export function resourceKeysForSandboxTool(name: string, args: Record<string, unknown>): string[] {
  const path = typeof args?.path === 'string' ? args.path : '';
  if (!path) return [];
  return harnessToolForSandboxTool(name) === 'workspace.patch' ? [`file:${path}`] : [];
}

/**
 * A tool call, recorded — or not, without ever disturbing the run.
 *
 * Every harness call here is wrapped, and the reason is the shape of
 * `startTool`: it throws when the turn's tool budget is spent, and the default
 * budget is 48 while a `new_project` route allows up to 320 calls. Left
 * unguarded, that throw would escape the tool handler, fail the round, and end
 * generation — bookkeeping breaking the thing it was meant to describe, which
 * is exactly the failure mode that kept this product silent for five days.
 *
 * So recording degrades to not recording. The run is the product; the trace is
 * how we explain it afterwards, and an explanation is never worth the thing it
 * explains.
 */
export async function recordToolCall<T>(
  harness: {
    startTool(input: { turnId: string; role: HarnessAgentRole; toolName: string; resourceKeys?: string[]; payload?: Record<string, unknown> }): Promise<{ id: string }>;
    completeTool(itemId: string, output?: Record<string, unknown>): Promise<unknown>;
    failTool(itemId: string, error: string): Promise<unknown>;
  } | null,
  context: { turnId: string; role: HarnessAgentRole } | null,
  call: { name: string; args: Record<string, unknown> },
  run: () => Promise<T>,
): Promise<T> {
  const toolName = harnessToolForSandboxTool(call.name);
  if (!harness || !context || !toolName) return run();

  let itemId: string | null = null;
  try {
    const item = await harness.startTool({
      turnId: context.turnId,
      role: context.role,
      toolName,
      resourceKeys: resourceKeysForSandboxTool(call.name, call.args),
      // The concrete tool, kept alongside the category: "workspace.patch" says
      // a file changed, `edit_file` says how, and a trace that cannot tell an
      // edit from a rewrite cannot explain a regression.
      payload: { sandboxTool: call.name, path: typeof call.args?.path === 'string' ? call.args.path : undefined },
    });
    itemId = item.id;
  } catch (error: any) {
    console.info('[coden:harness_tool_unrecorded]', { tool: call.name, reason: error?.message });
  }

  try {
    const result = await run();
    if (itemId) {
      // The outcome, not the payload: a tool result can be a whole file, and
      // the trace is read by people and log tooling, not replayed.
      const ok = (result as any)?.ok !== false;
      await harness.completeTool(itemId, { ok }).catch(() => undefined);
    }
    return result;
  } catch (error: any) {
    if (itemId) await harness.failTool(itemId, String(error?.message || error)).catch(() => undefined);
    throw error;
  }
}
