/**
 * The services a person connected (through Composio), for the agent, while it
 * works.
 *
 * The sandbox tools reach them through this provider rather than importing
 * Composio: the server installs it once at boot, and it resolves the person
 * from the request context, so a tool call can only ever act for the account
 * whose request is running. Absent (Composio not configured), the tools say
 * so and the agent carries on.
 */
import type { ServiceNeed } from './composio.ts';

export type IntegrationResult =
  | { ok: true; [key: string]: unknown }
  | { ok: false; error: string; hint?: string };

export type AgentIntegrationProvider = {
  /** Toolkits with an active connection for the current person. */
  connected(): Promise<string[]>;
  listTools(toolkit: string, search?: string): Promise<IntegrationResult>;
  runTool(tool: string, args: Record<string, unknown>, userRequestedAction: boolean): Promise<IntegrationResult>;
};

let activeProvider: AgentIntegrationProvider | null = null;
export function setAgentIntegrationProvider(provider: AgentIntegrationProvider | null) { activeProvider = provider; }
export function agentIntegrationProvider(): AgentIntegrationProvider | null { return activeProvider; }

export const SERVICE_NEEDS: ServiceNeed[] = ['database', 'auth', 'storage', 'payments', 'email', 'other'];
