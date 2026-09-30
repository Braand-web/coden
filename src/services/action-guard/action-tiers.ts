/**
 * Which of the three tiers an action belongs to, and what kind of action it is.
 *
 * Tier 1 looks and passes untouched. Tier 2 changes the user's own project and
 * gets a light automatic check. Tier 3 is everything else, and is judged.
 * Anything this table does not know is tier 3: a tool nobody classified is a
 * tool nobody vouched for.
 */
import type { ActionCategory, ActionTier, ToolAction } from './action-types.ts';

const READ_TOOLS = new Set(['list_files', 'read_file', 'search_files', 'get_logs', 'list_integration_tools', 'request_decision', 'request_connection']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'restart_server']);

/** Preview actions that only look, or that the preview's own policy already contains. */
const PREVIEW_QUIET = new Set(['capture', 'read', 'console', 'vitals', 'inspect', 'compare', 'wait', 'resize', 'theme', 'scroll', 'navigate', 'type']);

const READ_VERBS = /(?:^|_)(?:LIST|GET|SEARCH|FIND|FETCH|READ|RETRIEVE|DESCRIBE|COUNT|CHECK|LOOKUP|VIEW|SHOW|EXPORT_READ)(?:_|$)/i;
const WRITE_HINT = /(?:^|_)(?:SEND|POST|CREATE|UPDATE|DELETE|REMOVE|PAY|CHARGE|REFUND|INVITE|EXECUTE|RUN|DEPLOY|PUBLISH|SUBMIT|WRITE|INSERT|UPSERT|MERGE|CANCEL|TRANSFER|ADD|SET|GRANT|REVOKE|DROP|TRUNCATE|APPLY|MIGRATE|RESET|ARCHIVE|COMMENT|REPLY|FORWARD|SCHEDULE)(?:_|$)/i;

/** A connected service's tool that only reads. Unknown verbs count as writes: the safe way to be wrong. */
export function isReadOnlyIntegrationTool(name: string): boolean {
  const tool = String(name || '');
  return READ_VERBS.test(tool) && !WRITE_HINT.test(tool);
}

export function integrationCategory(name: string): ActionCategory {
  const tool = String(name || '').toUpperCase();
  if (isReadOnlyIntegrationTool(tool)) return 'read';
  if (/SMS|TEXT_MESSAGE|WHATSAPP|TWILIO/.test(tool)) return 'sms';
  if (/EMAIL|MAIL|GMAIL|OUTLOOK|SENDGRID|RESEND|MESSAGE|SLACK|DISCORD|TELEGRAM/.test(tool) && /SEND|POST|REPLY|FORWARD|DRAFT/.test(tool)) return 'email';
  if (/PAY|CHARGE|REFUND|INVOICE|SUBSCRIPTION|CHECKOUT|PAYOUT|TRANSFER/.test(tool)) return 'payment';
  if (/SQL|MIGRAT|DROP|TRUNCATE|DELETE_TABLE|DELETE_ROW|DATABASE|SCHEMA/.test(tool)) return 'database';
  if (/DEPLOY|PUBLISH|RELEASE|PROMOTE/.test(tool)) return 'deploy';
  if (/ENV|SECRET|API_KEY|TOKEN|VARIABLE/.test(tool)) return 'secrets';
  if (/PERMISSION|ROLE|GRANT|REVOKE|INVITE|COLLABORATOR|MEMBER|ACCESS/.test(tool)) return 'permissions';
  return 'third_party';
}

export function categoryOf(action: ToolAction): ActionCategory {
  const { tool, args } = action;
  if (READ_TOOLS.has(tool)) return 'read';
  if (WRITE_TOOLS.has(tool)) return 'project_write';
  switch (tool) {
    case 'delete_file': return 'project_write';
    case 'install_package': return 'install';
    case 'run_command': return 'shell';
    case 'fetch_url':
    case 'web_search': return 'network';
    case 'run_integration_tool': return integrationCategory(String(args.tool ?? ''));
    case 'delegate_to_subagents': return 'delegation';
    case 'save_skill':
    case 'record_error_lesson': return 'shared_content';
    case 'preview': return String(args.action) === 'click' && args.confirm === true ? 'ui_action' : 'read';
    default: return 'third_party';
  }
}

export function tierOf(action: ToolAction): ActionTier {
  const category = categoryOf(action);
  if (category === 'read') return 1;
  if (category === 'project_write') return 2;
  if (action.tool === 'preview' && PREVIEW_QUIET.has(String(action.args.action))) return 1;
  return 3;
}
