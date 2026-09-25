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
import { needsRestart } from './launch.ts';
import { DecisionRequiredError, isDecisionRequiredError, readDecisionRequest } from '../agent-decision.ts';
import { agentWebProvider } from '../agent-web.ts';
import { agentIntegrationProvider, SERVICE_NEEDS } from '../agent-integrations.ts';
import { SERVICE_CHOICES, type ServiceNeed } from '../composio.ts';

export type ToolResult =
  | { ok: true; [key: string]: unknown }
  | { ok: false; error: string; hint?: string };

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
    parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 0, description: 'Character offset, initially 0. Continue using nextOffset.' }, limit: { type: 'integer', minimum: 1, maximum: 12000 } }, required: ['path'] },
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
    description: 'Run a finite project check such as typecheck, test, or build. Never start a dev, start, serve, or preview process: Coden owns the live server and verifies it after the turn.',
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
  {
    name: 'web_search',
    description: 'Search the web. Use it when you need something your own knowledge may have wrong or out of date: the current API of a library or service, how to configure a provider, an error message you do not recognise. Not for things you already know well. Returns links and excerpts; read a page with fetch_url.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'A precise query, e.g. "react-router v7 createBrowserRouter loader".' } }, required: ['query'] },
  },
  {
    name: 'fetch_url',
    description: 'Read one public web page as text — official documentation, a changelog, an issue thread. Prefer official docs. Only public http(s) pages.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'list_integration_tools',
    description: 'List the actions available on a service the user has connected (the connected services are named in your instructions, e.g. github, supabase, stripe, notion). Use it before run_integration_tool to find the exact tool name and its parameters. Pass `search` to narrow it (e.g. "create table", "list repositories").',
    parameters: {
      type: 'object',
      properties: {
        toolkit: { type: 'string', description: 'The connected service, e.g. "supabase".' },
        search: { type: 'string', description: 'Optional words describing the action you need.' },
      },
      required: ['toolkit'],
    },
  },
  {
    name: 'run_integration_tool',
    description: 'Run one action on a service the user connected, as the user (their account, their data). Reading is fine whenever it helps the task. Anything that acts on the outside world — sending, posting, paying, deleting, inviting, running SQL — only when the user explicitly asked for that action in their request, and then set user_requested_action to true.',
    parameters: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Exact tool name from list_integration_tools, e.g. "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER".' },
        arguments: { type: 'object', description: 'The tool parameters.' },
        user_requested_action: { type: 'boolean', description: 'True only if the user explicitly asked for this outward action in this request.' },
      },
      required: ['tool'],
    },
  },
  {
    /*
     * The second tool that stops the run, for one precise case: the app
     * needs a service it does not have. The user answers with a button —
     * Coden Cloud, a service to connect through Composio, or another from the
     * catalogue — and the run resumes on its own once it is connected.
     */
    name: 'request_connection',
    description: [
      'Stop and ask the user which service to use when the app genuinely needs an external service that is not available yet: a database, user accounts (auth), file storage, payments or e-mail sending.',
      'Do NOT call it when your instructions say the project already has a live backend (Coden Cloud) that covers the need — use it. Do NOT call it when a matching service is already listed as connected — use it with list_integration_tools. Do NOT call it for something a front-end-only implementation honestly covers.',
      'The user sees choice buttons (e.g. Coden Cloud / Supabase / another database); the run resumes automatically once they have connected. Call it at most once per need, before writing code that depends on the service.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        need: { type: 'string', enum: ['database', 'auth', 'storage', 'payments', 'email', 'other'], description: 'What the app needs.' },
        reason: { type: 'string', description: 'One sentence: which feature needs it.' },
        service: { type: 'string', description: 'Optional: a specific service the user already named (e.g. "airtable"), offered first.' },
        question: { type: 'string', description: 'Optional: the question in the user language, if not French.' },
      },
      required: ['need'],
    },
  },
  {
    /*
     * The one tool that stops the run.
     *
     * Written to be hard to reach on purpose. A build that pauses to ask which
     * shade of blue costs the user a round trip and their confidence, and the
     * model's instinct when a task is under-specified is to ask rather than to
     * choose — so the description spends most of its length saying when NOT to
     * call this, and names the default behaviour (decide, state the choice,
     * carry on) that applies everywhere else.
     */
    name: 'request_decision',
    description: [
      'Stop the run and ask the user to decide. Use this ONLY when continuing would mean guessing at something you cannot recover from: deleting or overwriting work that is not yours to discard, picking between two incompatible directions that would each take the project somewhere different, or acting on a requirement that contradicts what is already built.',
      'Do NOT use it for preferences, naming, styling, or anything you can pick a sensible default for. Do NOT use it to confirm that you understood. Do NOT use it because a request is short or vague — make the reasonable choice, say which choice you made in your reply, and continue.',
      'Calling this ends the run until the user answers, so call it at most once, and only when you genuinely cannot proceed.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'One sentence: what you cannot decide alone, and why it blocks you.' },
        questions: {
          type: 'array',
          description: 'One to three questions, each answerable by picking from its options.',
          items: {
            type: 'object',
            properties: {
              q: { type: 'string', description: 'The question, in the user language.' },
              type: { type: 'string', enum: ['radio', 'check'], description: 'radio for one answer, check for several.' },
              options: { type: 'array', items: { type: 'string' }, description: 'Two to six concrete options.' },
            },
            required: ['q', 'type', 'options'],
          },
        },
      },
      required: ['reason', 'questions'],
    },
  },
] as const;

export type SandboxToolName = (typeof SANDBOX_TOOL_SCHEMAS)[number]['name'];

/** A package name npm will accept, and nothing that is really a flag or a URL. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(?:@[a-z0-9][a-z0-9.*+^~<>=_-]*)?$/i;

const PERSISTENT_SCRIPTS = new Set(['dev', 'start', 'preview', 'serve']);

/**
 * A check tool must always return. Starting a second preview server here used
 * to hold the agent loop until its three-minute command timeout while the
 * actual Coden-managed preview remained on "Building…".
 */
export function isPersistentPreviewCommand(command: string, args: readonly string[] = []): boolean {
  const binary = String(command || '').trim().toLowerCase();
  const argv = args.map(arg => String(arg || '').trim().toLowerCase()).filter(Boolean);

  if (binary === 'vite') return argv[0] !== 'build';
  if ((binary === 'npx' || binary === 'bunx') && argv[0] === 'vite') return argv[1] !== 'build';

  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(binary)) return false;
  if (PERSISTENT_SCRIPTS.has(argv[0] || '')) return true;
  if (argv[0] === 'run' || argv[0] === 'run-script') return PERSISTENT_SCRIPTS.has(argv[1] || '');
  return false;
}

export function createSandboxTools(projectId: string, options: { onChange?: (paths: string[]) => void; signal?: AbortSignal } = {}) {
  const sandbox: ProjectSandbox = sandboxRegistry.get(projectId);
  const changed = (paths: string[]) => options.onChange?.(paths);

  const handlers: Record<SandboxToolName, (args: any) => Promise<ToolResult>> = {
    async list_files() {
      const files = await sandbox.listFiles();
      return { ok: true, files, count: files.length };
    },

    async read_file({ path, offset = 0, limit = 12000 }: { path: string; offset?: number; limit?: number }) {
      try {
        const content = await sandbox.readProjectFile(String(path));
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) return fail('Invalid read range.');
        const end = Math.min(content.length, offset + Math.min(limit, 12000));
        return {
          ok: true,
          path,
          content: content.slice(offset, end),
          offset, totalChars: content.length, nextOffset: end < content.length ? end : null,
          truncated: end < content.length,
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
        const previous = await sandbox.readProjectFile(String(path)).catch(() => null);
        if (previous === String(content ?? '')) return { ok: true, path, unchanged: true, bytes: previous.length };
        await sandbox.writeFiles([{ path: String(path), content: String(content ?? '') }]);
        changed([String(path)]);
        return { ok: true, path, bytes: String(content ?? '').length, restartRequired: needsRestart([String(path)]) };
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
      if (needle === String(replace ?? '')) return { ok: true, path: target, unchanged: true, replaced: 0 };
      await sandbox.writeFiles([{ path: target, content: content.replace(needle, String(replace ?? '')) }]);
      changed([target]);
      return { ok: true, path: target, replaced: 1, restartRequired: needsRestart([target]) };
    },

    async delete_file({ path }: { path: string }) {
      try {
        if (!await sandbox.hasFile(String(path))) return { ok:true, path, unchanged:true };
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
      const args = ['install', packageName, ...(dev ? ['--save-dev'] : []), '--no-audit', '--no-fund', '--ignore-scripts'];
      const result = await sandbox.runCommand('npm', args, { timeoutMs: 120_000, allowReview: true, signal: options.signal });
      if (result.code !== 0) return fail(`npm install ${packageName} failed.`, result.output.slice(-1_500));
      // The dev server has to come back for a new dependency to be resolvable;
      // hot reload cannot introduce a module that was not on disk.
      changed(['package.json']);
      return { ok: true, package: packageName, restartRequired: true };
    },

    async run_command({ command, args }: { command: string; args?: string[] }) {
      const argv = Array.isArray(args) ? args.map(String) : [];
      if (isPersistentPreviewCommand(command, argv)) {
        return fail('Long-running preview commands are managed by Coden and cannot run as checks.', 'Use get_logs to inspect the existing dev server. Coden starts and verifies the preview automatically after this turn.');
      }
      const decision = decideCommand(String(command), argv);
      if (decision.verdict !== 'allowed') {
        return fail(`Refused: ${decision.reason}`, 'Use install_package to add a dependency.');
      }
      try {
        const result = await sandbox.runCommand(String(command), argv, { timeoutMs: 180_000, signal: options.signal });
        if (result.code !== 0 || result.timedOut) return {
          ...fail(result.timedOut ? 'COMMAND_TIMED_OUT' : 'COMMAND_FAILED'),
          exitCode: result.code, timedOut: result.timedOut, output: result.output.slice(-8000),
        };
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

    /*
     * Raises rather than returns.
     *
     * Every other handler answers the model. This one has nothing to answer
     * with: the run is over until a person replies, so it throws a type the
     * loop re-raises instead of feeding back as a tool result. A request the
     * card could not draw is not a decision — the run carries on and the model
     * is told to choose, which is better than stopping to show an empty box.
     */
    async request_decision(args: unknown) {
      const request = readDecisionRequest(args);
      if (!request) return fail('A decision needs at least one question with options. Choose a sensible default and continue.');
      throw new DecisionRequiredError(request.questions, request.reason);
    },

    async list_integration_tools(args) {
      const provider = agentIntegrationProvider();
      if (!provider) return fail('Connected services are not available here.', 'Continue without them and say what could not be done.');
      return provider.listTools(String(args.toolkit || ''), args.search ? String(args.search) : undefined) as Promise<ToolResult>;
    },

    async run_integration_tool(args) {
      const provider = agentIntegrationProvider();
      if (!provider) return fail('Connected services are not available here.');
      const toolArgs = args.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments) ? args.arguments as Record<string, unknown> : {};
      return provider.runTool(String(args.tool || ''), toolArgs, args.user_requested_action === true) as Promise<ToolResult>;
    },

    /*
     * Raises, like request_decision, with the connection actions attached to
     * each option so the card can connect instead of merely answering.
     */
    async request_connection(args) {
      const need = (SERVICE_NEEDS as string[]).includes(String(args.need)) ? String(args.need) as ServiceNeed : 'other';
      const provider = agentIntegrationProvider();
      const connected = provider ? await provider.connected().catch(() => [] as string[]) : [];
      const preset = SERVICE_CHOICES[need];
      let options = preset.options.filter(option => option.kind === 'coden_cloud' || provider);
      const named = String(args.service || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
      if (provider && named && !options.some(option => option.toolkit === named)) {
        options = [{ label: named.charAt(0).toUpperCase() + named.slice(1), kind: 'toolkit', toolkit: named }, ...options];
      }
      const already = options.find(option => option.kind === 'toolkit' && option.toolkit && connected.includes(option.toolkit));
      if (already) return fail(`${already.label} is already connected.`, `Use it: list_integration_tools with toolkit "${already.toolkit}".`);
      if (!options.length) return fail('No service can be connected from here.', 'Build the feature with Coden Cloud if the project has it, otherwise say clearly what the user must connect.');
      const question = String(args.question || '').trim().slice(0, 300) || preset.question;
      throw new DecisionRequiredError([{
        q: question,
        type: 'radio',
        options: options.map(option => option.label),
        connect: { need, choices: options.map(option => ({ kind: option.kind, ...(option.toolkit ? { toolkit: option.toolkit } : {}), ...(option.search ? { search: option.search } : {}) })) },
      }], String(args.reason || `The app needs ${need}.`).slice(0, 300));
    },

    async web_search(args) {
      const provider = agentWebProvider();
      if (!provider) return fail('Web search is not available here.', 'Continue with what you know and say what you could not check.');
      return provider.search(String(args.query || '')) as Promise<ToolResult>;
    },

    async fetch_url(args) {
      const provider = agentWebProvider();
      if (!provider) return fail('Reading web pages is not available here.');
      return provider.fetch(String(args.url || '')) as Promise<ToolResult>;
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
        /*
         * One throw is allowed through: the one that means "stop".
         *
         * Everything else becomes a result, because a tool that reports lets
         * the model try something else — the whole point of a tool loop. A
         * decision is the opposite: turned into a result here it would reach
         * the model as "the tool failed", and it would work around the very
         * point it had just said it could not pass. Both this dispatcher and
         * the loop above it had to stop swallowing it.
         */
        if (isDecisionRequiredError(error)) throw error;
        return fail(error?.message || 'The tool failed.');
      }
    },
  };
}
