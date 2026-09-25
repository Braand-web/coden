/**
 * What a person told Coden about how they want it to work, carried into every
 * agent call made on their behalf.
 *
 * Two settings live here (table user_agent_preferences):
 * - `instructions`: free text ("Utilise toujours Tailwind", "Réponds en
 *   français"), injected into the system prompt of every session, whatever
 *   the model, Auto included, right after the platform's own rules;
 * - `share_improvement`: whether their runs may feed the global, anonymised
 *   knowledge base (agent-knowledge.ts). On by default; turning it off stops
 *   collection and purges past contributions.
 *
 * The request's context is held in AsyncLocalStorage so the many places that
 * build a system prompt (planner, coder, specialists, repair loop, chat
 * answers) all read the same value without threading it through every call.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export const MAX_USER_INSTRUCTIONS = 4000;

export type AgentPersonalization = {
  userId: string;
  instructions: string;
  shareImprovement: boolean;
  /** This user's private memory (stack, style, language), rendered for the prompt. */
  userMemory?: string;
  /** Services connected through Composio (toolkit slugs), when integrations are enabled. */
  connectedToolkits?: string[];
};

const store = new AsyncLocalStorage<AgentPersonalization>();

export function runWithPersonalization<T>(value: AgentPersonalization, fn: () => T): T {
  return store.run(value, fn);
}

export function currentPersonalization(): AgentPersonalization | undefined {
  return store.getStore();
}

/** Trimmed, bounded, without control characters other than line breaks and tabs. */
export function normalizeInstructions(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, MAX_USER_INSTRUCTIONS);
}

/**
 * The block appended to a system prompt.
 *
 * Framed so its authority is explicit: above every default of style, stack,
 * language and tone, below the platform's security rules. The text is the
 * user's own and only ever reaches their own sessions.
 */
export function renderUserInstructionsBlock(instructions: string, userMemory?: string, connectedToolkits?: string[]): string {
  const text = normalizeInstructions(instructions);
  const memory = String(userMemory || '').trim();
  const services = (connectedToolkits || []).filter(slug => /^[a-z0-9_-]{1,64}$/.test(slug)).slice(0, 40);
  if (!text && !memory && !services.length) return '';
  const parts: string[] = [];
  if (text) {
    parts.push(
      'USER INSTRUCTIONS — written by the person you are working for, applying to every task in this session.',
      'Follow them with the highest priority after Coden\'s platform and security rules: they override your defaults for stack, libraries, language, tone, code style and conventions. If one conflicts with a security rule (secrets, other users\' data, destructive actions without confirmation), keep the security rule and say briefly why.',
      '<user_instructions>',
      text,
      '</user_instructions>',
    );
  }
  if (memory) {
    parts.push(
      'WHAT YOU KNOW ABOUT THIS USER — learned from their own previous sessions, private to them. Prefer it when their request leaves a choice open; their explicit instructions and request always win.',
      memory,
    );
  }
  if (services.length) {
    parts.push(
      `CONNECTED SERVICES — the user connected these accounts to Coden: ${services.join(', ')}. When a task involves one of them, use it for real (list_integration_tools, then run_integration_tool) instead of mocking it; never expose its credentials in the app's code.`,
    );
  }
  return parts.join('\n');
}

/**
 * A system prompt with the current user's instructions and private memory
 * appended, or unchanged when there are none (or no request context).
 */
export function withUserInstructions(systemContent: string, value: AgentPersonalization | undefined = currentPersonalization()): string {
  if (!value) return systemContent;
  const block = renderUserInstructionsBlock(value.instructions, value.userMemory, value.connectedToolkits);
  return block ? `${systemContent}\n\n${block}` : systemContent;
}
