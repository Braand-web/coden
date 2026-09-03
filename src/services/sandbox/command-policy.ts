/**
 * What a sandbox is allowed to run.
 *
 * The agent decides commands from a model's output, so this is the boundary
 * between "the model asked for something" and "the host does it". The policy
 * is an allow-list, not a deny-list: a deny-list of dangerous commands is a
 * list of the attacks someone already thought of, and the interesting ones are
 * always the others.
 *
 * Three outcomes rather than two — `review` exists because a package install
 * is legitimate and routine, but is also how arbitrary code reaches the host,
 * so it is a decision a caller makes deliberately instead of a default.
 */

export type CommandVerdict = 'allowed' | 'review' | 'blocked';

export type CommandDecision = {
  verdict: CommandVerdict;
  reason: string;
};

/** Executables a sandbox may run at all. Everything else is blocked. */
const ALLOWED_BINARIES = new Set(['npm', 'npx', 'node', 'pnpm', 'yarn', 'bun', 'bunx', 'tsc', 'vite']);

/** Package-manager subcommands that fetch and execute third-party code. */
const INSTALL_SUBCOMMANDS = new Set(['install', 'i', 'add', 'ci', 'update', 'upgrade', 'create', 'dlx', 'exec']);

/**
 * Shell metacharacters.
 *
 * Commands run without a shell, so these cannot chain anything — but their
 * presence means the caller built a shell string where an argv was expected,
 * and that mistake is worth failing on rather than silently passing `&&` to a
 * program as a literal argument.
 */
const SHELL_METACHARACTERS = /[;&|`$><\n\r]|\$\(|\|\|/;

export function decideCommand(binary: string, args: readonly string[] = []): CommandDecision {
  const name = String(binary || '').trim();
  if (!name) return { verdict: 'blocked', reason: 'No command given.' };
  if (name.includes('/') || name.includes('\\')) {
    return { verdict: 'blocked', reason: `Commands are named, not pathed: ${name}` };
  }
  if (!ALLOWED_BINARIES.has(name)) {
    return { verdict: 'blocked', reason: `${name} is not on the sandbox allow-list.` };
  }
  for (const arg of args) {
    const value = String(arg ?? '');
    if (SHELL_METACHARACTERS.test(value)) {
      return { verdict: 'blocked', reason: `Shell syntax is not available in a sandbox: ${value}` };
    }
  }
  const first = String(args[0] ?? '').trim();
  if (INSTALL_SUBCOMMANDS.has(first)) {
    return { verdict: 'review', reason: `${name} ${first} fetches and runs third-party code.` };
  }
  // `npm run <script>` runs whatever package.json says, which is the project's
  // own code — that is the point of a sandbox, not a reason to refuse.
  return { verdict: 'allowed', reason: `${name} ${first}`.trim() };
}

/** Convenience for callers that only proceed on an outright allow. */
export function isAllowedCommand(binary: string, args: readonly string[] = []): boolean {
  return decideCommand(binary, args).verdict === 'allowed';
}
