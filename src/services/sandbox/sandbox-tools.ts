/**
 * What the agent can actually do to a project.
 *
 * The generation path asks a model for the whole application as one JSON
 * document and writes whatever comes back. That works for the first message
 * and is wrong for every one after it: "make the button blue" costs a full
 * re-emission of every file, takes as long as the original build, and gives
 * the model a fresh chance to lose something it wrote earlier.
 *
 * These are the operations that make an incremental change incremental. Each
 * one is scoped to a single project's sandbox, each returns a result the model
 * can reason about rather than a boolean, and each failure is a value rather
 * than an exception — a model that is told "that file does not exist, here are
 * the ones that do" recovers, where one that is handed a stack trace tends to
 * invent.
 */

import { sandboxRegistry } from './sandbox-registry.ts';
import type { ProjectSandbox } from './project-sandbox.ts';
import { decideCommand } from './command-policy.ts';

export type ToolResult =
  | { ok: true; [key: string]: unknown }
  | { ok: false; error: string; hint?: string };

/** How much of a file is worth putting in a prompt. */
const MAX_FILE_CHARS = 60_000;
const MAX_SEARCH_HITS = 40;

function fail(error: string, hint?: string): ToolResult {
  return hint ? { ok: false, error, hint } : { ok: false, error };
}

/**
 * The tools, as JSON schemas a provider can be given.
 *
 * Descriptions are written for the model, so they say when to use a tool and
 * not merely what it does: the common failure is not a model that cannot call
 * `write_file`, it is one that rewrites six files when it needed to edit one.
 */
export const SANDBOX_TOOL_SCHEMAS = [
  {
    name: 'list_files',
    description: 'List the project files. Call this before assuming a path exists.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'read_file',
    description: 'Read one file. Read before editing: an edit written from memory of a previous message is how a project loses work.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'search_files',
    description: 'Find which files contain a string. Use this to locate the component to change instead of reading the whole project.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, glob: { type: 'string', description: 'Optional path substring filter.' } },
      required: ['query'],
    },
  },
  {
    name: 'write_file',
    description: 'Create a file, or replace one entirely. For a change to part of an existing file prefer edit_file.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact snippet in a file. The snippet must appear exactly once, so include enough surrounding lines to be unambiguous.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } },
      required: ['path', 'find', 'replace'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file that is no longer part of the application.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'install_package',
    description: 'Add a dependency. Only for packages the application imports; the scaffold already provides React, Tailwind and TypeScript.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' }, dev: { type: 'boolean' } },
      required: ['name'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a project script, such as typecheck or build. Use it to check work rather than to assert that it is correct.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } },
      required: ['command'],
    },
  },
  {
    name: 'get_logs',
    description: 'Read the dev server output. This is where a runtime error that is invisible in the source will be.',
    parameters: { type: 'object', properties: { limit: { type: 'number' } }, required: [] },
  },
  {
    name: 'restart_server',
    description: 'Restart the dev server. Only needed after a dependency or build-config change; an edit to a component is hot-reloaded already.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
] as const;

export type SandboxToolName = (typeof SANDBOX_TOOL_SCHEMAS)[number]['name'];

/** A package name npm will accept, and nothing that is really a flag or a URL. */
const PACKAGE_NAME = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:@[\w.^~>=<|| -]+)?$/i;

export function createSandboxTools(projectId: string, options: { onChange?: (paths: string[]) => void } = {}) {
  const sandbox: ProjectSandbox = sandboxRegistry.get(projectId);
  const changed = (paths: string[]) => options.onChange?.(paths);

  const handlers: Record<SandboxToolName, (args: any) => Promise<ToolResult>> = {
    async list_files() {
      const files = await sandbox.listFiles();
      return { ok: true, files, count: files.length };
    },

    async read_file({ path }: { path: string }) {
      try {
        const content = await sandbox.readProjectFile(String(path));
        return {
          ok: true,
          path,
          content: content.slice(0, MAX_FILE_CHARS),
          truncated: content.length > MAX_FILE_CHARS,
        };
      } catch {
        // Naming the alternatives is what turns a miss into a correction
        // rather than an invention.
        const files = await sandbox.listFiles();
        return fail(`No file at ${path}.`, `Existing files: ${files.slice(0, 40).join(', ')}`);
      }
    },

    async search_files({ query, glob }: { query: string; glob?: string }) {
      const needle = String(query || '');
      if (!needle) return fail('A search needs a query.');
      const files = await sandbox.listFiles();
      const matches: Array<{ path: string; line: number; text: string }> = [];
      for (const file of files) {
        if (glob && !file.includes(String(glob))) continue;
        let content: string;
        try { content = await sandbox.readProjectFile(file); } catch { continue; }
        if (!content.includes(needle)) continue;
        content.split('\n').forEach((text, index) => {
          if (matches.length >= MAX_SEARCH_HITS || !text.includes(needle)) return;
          matches.push({ path: file, line: index + 1, text: text.trim().slice(0, 200) });
        });
        if (matches.length >= MAX_SEARCH_HITS) break;
      }
      return { ok: true, matches, count: matches.length };
    },

    async write_file({ path, content }: { path: string; content: string }) {
      try {
        await sandbox.writeFiles([{ path: String(path), content: String(content ?? '') }]);
        changed([String(path)]);
        return { ok: true, path, bytes: String(content ?? '').length };
      } catch (error: any) {
        return fail(error?.message || 'The file could not be written.');
      }
    },

    async edit_file({ path, find, replace }: { path: string; find: string; replace: string }) {
      const target = String(path);
      let content: string;
      try {
        content = await sandbox.readProjectFile(target);
      } catch {
        return fail(`No file at ${target}.`, 'Use write_file to create it.');
      }
      const needle = String(find ?? '');
      if (!needle) return fail('edit_file needs the snippet to replace.');
      const occurrences = content.split(needle).length - 1;
      if (occurrences === 0) {
        return fail(`That snippet does not appear in ${target}.`, 'Read the file again — it may have changed since you last saw it.');
      }
      // Refusing an ambiguous edit rather than guessing: replacing the first of
      // three identical snippets silently changes the wrong one, and the model
      // has no way to notice.
      if (occurrences > 1) {
        return fail(`That snippet appears ${occurrences} times in ${target}.`, 'Include more surrounding lines so it matches exactly once.');
      }
      await sandbox.writeFiles([{ path: target, content: content.replace(needle, String(replace ?? '')) }]);
      changed([target]);
      return { ok: true, path: target, replaced: 1 };
    },

    async delete_file({ path }: { path: string }) {
      try {
        await sandbox.deleteProjectFile(String(path));
        changed([String(path)]);
        return { ok: true, path };
      } catch (error: any) {
        return fail(error?.message || 'The file could not be deleted.');
      }
    },

    async install_package({ name, dev }: { name: string; dev?: boolean }) {
      const packageName = String(name || '').trim();
      if (!PACKAGE_NAME.test(packageName)) {
        return fail(`${packageName || '(empty)'} is not a package name.`, 'Give a package name, optionally with a version.');
      }
      const args = ['install', packageName, ...(dev ? ['--save-dev'] : []), '--no-audit', '--no-fund'];
      const result = await sandbox.runCommand('npm', args, { timeoutMs: 120_000, allowReview: true });
      if (result.code !== 0) return fail(`npm install ${packageName} failed.`, result.output.slice(-1_500));
      // The dev server has to come back for a new dependency to be resolvable;
      // hot reload cannot introduce a module that was not on disk.
      changed(['package.json']);
      return { ok: true, package: packageName, restartRequired: true };
    },

    async run_command({ command, args }: { command: string; args?: string[] }) {
      const argv = Array.isArray(args) ? args.map(String) : [];
      const decision = decideCommand(String(command), argv);
      if (decision.verdict !== 'allowed') {
        return fail(`Refused: ${decision.reason}`, 'Use install_package to add a dependency.');
      }
      try {
        const result = await sandbox.runCommand(String(command), argv, { timeoutMs: 180_000 });
        return {
          ok: true,
          exitCode: result.code,
          timedOut: result.timedOut,
          // The tail, not the head: a compiler prints its errors last.
          output: result.output.slice(-8_000),
        };
      } catch (error: any) {
        return fail(error?.message || 'The command could not be run.');
      }
    },

    async get_logs({ limit }: { limit?: number }) {
      const entries = sandbox.getLogs(Math.min(Number(limit) || 80, 300));
      return { ok: true, logs: entries.map(entry => `[${entry.stream}] ${entry.line}`) };
    },

    async restart_server() {
      const before = sandbox.status();
      await sandbox.stop();
      const status = await sandbox.start({ basePath: before.basePath || undefined });
      if (status.state !== 'running') {
        return fail(status.lastError || 'The dev server did not restart.', sandbox.getLogs(40).map(entry => entry.line).join('\n'));
      }
      return { ok: true, state: status.state, url: status.basePath };
    },
  };

  return {
    schemas: SANDBOX_TOOL_SCHEMAS,
    /** Dispatch one call. An unknown name is a result, not a throw. */
    async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
      const handler = handlers[name as SandboxToolName];
      if (!handler) {
        return fail(`Unknown tool: ${name}`, `Available: ${SANDBOX_TOOL_SCHEMAS.map(tool => tool.name).join(', ')}`);
      }
      try {
        return await handler(args || {});
      } catch (error: any) {
        // A tool that throws ends the run. A tool that reports lets the model
        // try something else, which is the whole point of a tool loop.
        return fail(error?.message || 'The tool failed.');
      }
    },
  };
}
