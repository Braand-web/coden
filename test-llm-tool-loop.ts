import assert from 'node:assert/strict';
import { runLlmToolLoop } from './src/services/llm-tool-loop.ts';
import type { ChatMessage } from './src/services/openrouter-service.ts';
import { getAgentToolDefinition, toolNeedsApproval } from './src/services/agent-tools.ts';

const calls: ChatMessage[][] = [];
const gateway = {
  async chat(_modelId: string, messages: ChatMessage[]) {
    calls.push(messages.map(message => ({ ...message })));
    if (calls.length === 1) {
      return {
        text: '',
        model: 'openai/gpt-5.6-luna-pro',
        tool_calls: [{
          id: 'tool_1',
          type: 'function' as const,
          function: { name: 'inspect_project_files', arguments: '{"paths":["src/App.tsx"]}' },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        cost_usd: 0,
      };
    }
    return {
      text: 'I inspected the file and can continue.',
      model: 'openai/gpt-5.6-luna-pro',
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      cost_usd: 0,
    };
  },
} as any;

const result = await runLlmToolLoop({
  gateway,
  modelId: 'openai/gpt-5.6-luna-pro',
  messages: [{ role: 'user', content: 'Inspect the app.' }],
  handlers: {
    inspect_project_files: ({ paths }) => ({ paths, content: 'export default function App() {}' }),
  },
});

assert.equal(result.result.text, 'I inspected the file and can continue.');
assert.equal(result.toolExecutions.length, 1);
assert.equal(result.toolExecutions[0].ok, true);
assert.ok(calls[1].some(message => message.role === 'tool' && message.tool_call_id === 'tool_1'));

assert.equal(getAgentToolDefinition('apply_migration')?.needsApproval, true);
assert.equal(getAgentToolDefinition('write_file')?.needsApproval, false);
assert.equal(toolNeedsApproval('apply_migration', { sql: 'drop table users;' }), true);

let migrationExecuted = false;
const blockedCalls: ChatMessage[][] = [];
const migrationGateway = {
  async chat(_modelId: string, messages: ChatMessage[]) {
    blockedCalls.push(messages.map(message => ({ ...message })));
    if (blockedCalls.length === 1) {
      return {
        text: '',
        model: 'openai/gpt-5.6-luna-pro',
        tool_calls: [{
          id: 'tool_migration',
          type: 'function' as const,
          function: { name: 'apply_migration', arguments: '{"sql":"drop table users;"}' },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        cost_usd: 0,
      };
    }
    return {
      text: 'Waiting for approval.',
      model: 'openai/gpt-5.6-luna-pro',
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      cost_usd: 0,
    };
  },
} as any;

const blocked = await runLlmToolLoop({
  gateway: migrationGateway,
  modelId: 'openai/gpt-5.6-luna-pro',
  messages: [{ role: 'user', content: 'Apply a migration.' }],
  handlers: {
    apply_migration: () => {
      migrationExecuted = true;
      return { applied: true };
    },
  },
});

assert.equal(migrationExecuted, false, 'sensitive tools must not execute without approval');
assert.equal(blocked.toolExecutions[0].ok, false);
assert.equal(blocked.toolExecutions[0].approvalRequired, true);
assert.equal(blocked.toolExecutions[0].approved, false);
assert.ok(blocked.messages.some(message => message.role === 'tool' && /TOOL_APPROVAL_REQUIRED/.test(String(message.content || ''))));

let approvedMigrationExecuted = false;
let approvalRequestSeen = false;
const approvedCalls: ChatMessage[][] = [];
const approvedGateway = {
  async chat(_modelId: string, messages: ChatMessage[]) {
    approvedCalls.push(messages.map(message => ({ ...message })));
    if (approvedCalls.length === 1) {
      return {
        text: '',
        model: 'openai/gpt-5.6-luna-pro',
        tool_calls: [{
          id: 'tool_migration_approved',
          type: 'function' as const,
          function: { name: 'apply_migration', arguments: '{"sql":"create table notes(id uuid primary key);"}' },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        cost_usd: 0,
      };
    }
    return {
      text: 'Migration applied.',
      model: 'openai/gpt-5.6-luna-pro',
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      cost_usd: 0,
    };
  },
} as any;

const approved = await runLlmToolLoop({
  gateway: approvedGateway,
  modelId: 'openai/gpt-5.6-luna-pro',
  messages: [{ role: 'user', content: 'Apply the approved migration.' }],
  approvalResolver: async request => {
    approvalRequestSeen = request.name === 'apply_migration' && /Database migrations/.test(request.reason);
    return true;
  },
  handlers: {
    apply_migration: () => {
      approvedMigrationExecuted = true;
      return { applied: true };
    },
  },
});

assert.equal(approvalRequestSeen, true);
assert.equal(approvedMigrationExecuted, true);
assert.equal(approved.toolExecutions[0].ok, true);
assert.equal(approved.toolExecutions[0].approvalRequired, true);
assert.equal(approved.toolExecutions[0].approved, true);

console.log('llm tool loop tests passed');
