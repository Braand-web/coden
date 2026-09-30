/**
 * The protected core.
 *
 * Rules that no consent, no project rule and no model verdict can lift. They
 * are deterministic on purpose: a probabilistic judge must never be the only
 * barrier, and these are the lines whose crossing cannot be undone — another
 * person's data, a secret leaving, the sandbox's walls, the guard itself.
 *
 * They read the action's parameters only. Nothing here looks at what the agent
 * said, and nothing in a page or a file can turn one off.
 */
import { looksLikeLiveSecret } from '../preview-tool/preview-policy.ts';
import type { GuardContext, ToolAction } from './action-types.ts';

export type HardRuleHit = { rule: string; reason: string };

/** Tools that act on a shell, the network or a connected service: where a secret would actually leave. */
const OUTBOUND_TOOLS = new Set(['run_command', 'fetch_url', 'web_search', 'run_integration_tool', 'install_package', 'preview']);

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const OWNER_KEYS = /^(?:project_?id|user_?id|owner_?id|organi[sz]ation_?id|org_?id|account_?id|tenant_?id|workspace_?id)$/i;

/** Names that read the environment or the machine's credentials. */
export const SECRET_READ = /(?:^|[\s"'`=(,/\\])printenv(?:$|[\s"'`;|)])|process\.env|import\.meta\.env|\/proc\/(?:self|\d+)\/environ|(?:^|[\s"'`/])\.env(?:\.[a-z]+)?(?:$|[\s"'`])|\.ssh\/|id_(?:rsa|ed25519)|\.aws\/credentials|\.npmrc|\.git-credentials|\.netrc|service[_-]?role|SUPABASE_SERVICE|OPENROUTER_API_KEY|STRIPE_SECRET/i;

const ISOLATION_TOKENS = new Set(['docker', 'podman', 'nsenter', 'chroot', 'unshare', 'mount', 'umount', 'sudo', 'su', 'setcap', 'capsh', 'insmod', 'modprobe', 'kubectl', 'nc', 'ncat', 'netcat', 'socat', 'ssh', 'scp', 'mkfifo']);
const ISOLATION_TEXT = /child_process|\/bin\/(?:ba|z)?sh\b|require\(\s*["']net["']\s*\)|require\(\s*["']dgram["']\s*\)|\/var\/run\/docker\.sock|169\.254\.169\.254|metadata\.google\.internal|100\.100\.100\.200|\/dev\/tcp\/|\bbash\s+-i\b|(?:curl|wget)\b[^\n|]{0,160}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\/proc\/1\/|\/sys\/fs\/cgroup|--privileged|host\.docker\.internal/i;

/** Where the guard itself and its rules live: nothing an agent writes may reach them. */
const GUARD_TAMPER = /action-guard|guard[-_]rules|\.coden[/\\]guard|CODEN_ACTION_GUARD|classifier\.ts|hard-rules\.ts/i;

const flat = (value: unknown): string => {
  try { return typeof value === 'string' ? value : JSON.stringify(value) ?? ''; } catch { return String(value); }
};

function tokens(action: ToolAction): string[] {
  const parts = [String(action.args.command ?? ''), ...(Array.isArray(action.args.args) ? action.args.args.map(String) : [])];
  return parts.flatMap(part => part.split(/[\s"'`=;|&()<>]+/)).map(part => part.replace(/^.*[/\\]/, '').toLowerCase()).filter(Boolean);
}

/** Every key of a nested object that names an owner, with its string value. */
function ownerReferences(value: unknown, depth = 0): string[] {
  if (depth > 5 || !value || typeof value !== 'object') return [];
  const found: string[] = [];
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (OWNER_KEYS.test(key) && typeof item === 'string') found.push(item);
    else if (item && typeof item === 'object') found.push(...ownerReferences(item, depth + 1));
  }
  return found;
}

/** A path that leaves the project: absolute, home-relative, or climbing out with `..`. */
export function escapesProject(path: unknown): boolean {
  const value = String(path ?? '').replace(/\\/g, '/');
  if (!value) return false;
  return value.startsWith('/') || value.startsWith('~') || /(?:^|\/)\.\.(?:\/|$)/.test(value) || /^[a-z]:\//i.test(value);
}

export function hardRules(action: ToolAction, context: GuardContext): HardRuleHit | null {
  const { tool, args } = action;
  const text = flat(args);

  // 1. Another person's data. A call that names an owner other than this run's is never legitimate.
  const own = new Set([context.projectId, context.userId, context.organizationId].filter(Boolean).map(value => String(value).toLowerCase()));
  for (const reference of ownerReferences(args)) {
    const values = reference.match(UUID) || [];
    if (values.some(value => !own.has(value.toLowerCase()))) {
      return { rule: 'other_owner', reason: 'Cette action vise les données d’un autre projet ou d’un autre compte.' };
    }
  }

  // 2. The protected core cannot be edited, from any tool.
  const writtenPath = String(args.path ?? '');
  if (GUARD_TAMPER.test(writtenPath) || (tool === 'run_command' && GUARD_TAMPER.test(text)) || (tool === 'delegate_to_subagents' && /(?:disable|turn off|bypass|remove|désactive|contourne|supprime)[^.\n]{0,40}(?:classifier|guard|classifieur|garde)/i.test(text))) {
    return { rule: 'protected_core', reason: 'Le système de sécurité de Coden ne peut pas être modifié par un agent.' };
  }

  // 3. Leaving the project.
  if ((tool === 'write_file' || tool === 'edit_file' || tool === 'delete_file' || tool === 'read_file') && escapesProject(args.path)) {
    return { rule: 'outside_project', reason: 'Ce chemin sort du projet de l’utilisateur.' };
  }

  if (!OUTBOUND_TOOLS.has(tool) && tool !== 'delegate_to_subagents') return null;

  // 4. Secrets leaving, or the machine's credentials being read.
  if (looksLikeLiveSecret(text)) return { rule: 'secret_exfiltration', reason: 'Cette action ferait sortir une clé ou un secret.' };
  if (tool === 'run_command' && SECRET_READ.test(` ${text} `)) return { rule: 'secret_read', reason: 'Cette commande lirait des variables d’environnement ou des identifiants.' };
  if ((tool === 'fetch_url' || tool === 'run_integration_tool') && SECRET_READ.test(` ${text} `)) return { rule: 'secret_read', reason: 'Cette action embarque des identifiants ou des variables d’environnement.' };

  // 5. The sandbox's walls.
  if (tool === 'run_command') {
    const bad = tokens(action).find(token => ISOLATION_TOKENS.has(token));
    if (bad) return { rule: 'isolation', reason: `« ${bad} » sort de l’environnement isolé du projet.` };
  }
  if (tool === 'run_command' || tool === 'fetch_url') {
    if (ISOLATION_TEXT.test(text)) return { rule: 'isolation', reason: 'Cette action tente de sortir de l’environnement isolé.' };
  }
  return null;
}
