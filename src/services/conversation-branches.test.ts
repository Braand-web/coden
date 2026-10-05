import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { branchMetadataForMessage, conversationMessageKey, resolveConversationBranch, type ConversationMessageRecord } from './conversation-branches';

const base: ConversationMessageRecord[] = [
  { id: 'u1', ai_message_id: 'u1', role: 'user', content: 'Première demande', created_at: '2026-10-01T10:00:00Z' },
  { id: 'a1', ai_message_id: 'a1', role: 'assistant', content: 'Première réponse', created_at: '2026-10-01T10:01:00Z' },
  { id: 'u2', ai_message_id: 'u2', role: 'user', content: 'Ancienne demande', created_at: '2026-10-01T10:02:00Z' },
  { id: 'a2', ai_message_id: 'a2', role: 'assistant', content: 'Ancienne réponse', created_at: '2026-10-01T10:03:00Z' },
];

describe('durable conversation branches', () => {
  it('keeps the original transcript and replaces the forked request only in the new branch', () => {
    const edited = {
      id: 'u2-edit', ai_message_id: 'u2-edit', role: 'user', content: 'Demande corrigée', created_at: '2026-10-01T10:04:00Z',
      metadata: branchMetadataForMessage({}, 'branch-a', { parentMessageId: 'u2' }),
    };
    const reply = {
      id: 'a2-edit', ai_message_id: 'a2-edit', role: 'assistant', content: 'Nouvelle réponse', created_at: '2026-10-01T10:05:00Z',
      metadata: branchMetadataForMessage({}, 'branch-a'),
    };
    const all = [...base, edited, reply];

    expect(resolveConversationBranch(all, 'branch-a').map(message => message.content)).toEqual([
      'Première demande', 'Première réponse', 'Demande corrigée', 'Nouvelle réponse',
    ]);
    expect(resolveConversationBranch(all).map(message => message.content)).toEqual(base.map(message => message.content));
    expect(conversationMessageKey(edited)).toBe('u2-edit');
  });

  it('supports nested branches and deep links ending at a specific message', () => {
    const firstBranch = {
      id: 'u2-edit', ai_message_id: 'u2-edit', role: 'user', content: 'Branche une', created_at: '2026-10-01T10:04:00Z',
      metadata: branchMetadataForMessage({}, 'branch-a', { parentMessageId: 'u2' }),
    };
    const firstReply = {
      id: 'a2-edit', ai_message_id: 'a2-edit', role: 'assistant', content: 'Réponse une', created_at: '2026-10-01T10:05:00Z',
      metadata: branchMetadataForMessage({}, 'branch-a'),
    };
    const secondBranch = {
      id: 'u2-second', ai_message_id: 'u2-second', role: 'user', content: 'Branche deux', created_at: '2026-10-01T10:06:00Z',
      metadata: branchMetadataForMessage({}, 'branch-b', { parentBranchId: 'branch-a', parentMessageId: 'u2-edit' }),
    };
    const all = [...base, firstBranch, firstReply, secondBranch];

    expect(resolveConversationBranch(all, 'branch-b').map(message => message.content)).toEqual([
      'Première demande', 'Première réponse', 'Branche deux',
    ]);
    expect(resolveConversationBranch(all, 'branch-a', 'a2-edit').at(-1)?.id).toBe('a2-edit');
    expect(resolveConversationBranch(all, 'branch-a', 'not-found')).toEqual([]);
  });

  it('keeps message and generation routes private and derives fork history on the server', () => {
    const server = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
    const messagesRoute = server.slice(server.indexOf("app.get('/api/projects/:id/messages'"), server.indexOf("app.get('/api/projects/:id/events'"));
    const projectRouteStart = server.indexOf("app.get('/api/projects/:id',");
    const projectRoute = server.slice(projectRouteStart, server.indexOf("app.patch('/api/projects/:id'", projectRouteStart));
    const assistantStart = server.indexOf("app.post('/api/assistant/chat'");
    const assistantRoute = server.slice(assistantStart, server.indexOf("app.post('/api/chat'", assistantStart));
    const generationStart = server.indexOf("app.post('/api/projects/:id/generate'");
    const generationRoute = server.slice(generationStart, server.indexOf('const generationDeadline', generationStart));

    expect(messagesRoute.indexOf('await loadProject')).toBeGreaterThanOrEqual(0);
    expect(messagesRoute.indexOf('await loadProject')).toBeLessThan(messagesRoute.indexOf('listProjectConversationMessages'));
    expect(messagesRoute).toContain("return res.status(404).json({ success: false, error: 'Message not found.' })");
    expect(assistantRoute).toContain('prepareAgentHarnessContext({');
    expect(assistantRoute).toContain('harnessContext.harness.store.updateItem(harnessContext.assistantItemId, { content: redactSecrets(content) })');
    expect(assistantRoute).toContain('parentTurnId: branchFork?.parentTurnId');
    expect(assistantRoute).toContain("type: 'run_acknowledged'");
    expect(assistantRoute).toContain('userMessageId,');
    expect(assistantRoute).toContain('threadId: harnessContext?.thread.id || null');
    expect(assistantRoute).toContain('conversationForkContext(projectMessages, branchFromMessageId, userId)');
    expect(projectRoute).toContain('recovered.messages = resolveConversationBranch(recovered.messages || [], null)');
    expect(generationRoute.indexOf('requireAuthenticatedUser')).toBeLessThan(generationRoute.indexOf('await loadProject'));
    expect(generationRoute).toContain('conversationForkContext(projectMessages, branchFromMessageId, userId)');
    expect(generationRoute).toContain('parentTurnId,');
    expect(server).toContain("type: 'run_acknowledged'");
    expect(server).toContain('userMessageId: userDurableMessageId');
    expect(server).toContain('const recentHistory = branchFork ? branchFork.prefix : dropCurrentPrompt(conversation.turns, prompt)');
    expect(server).toContain('const sessionContext = branchFork ? undefined : conversation.sessionContext');
    expect(server).toContain("parentTurnId: typeof harness.turn_id === 'string' ? harness.turn_id : null");
    expect(server).toContain('branchFork ? Promise.resolve(\'\') : getLastProjectPlan(project.id)');
    expect(server).toContain('branchFork ? Promise.resolve([]) : listAgentMemory(project.id).catch(() => [])');
    expect(server).not.toContain('recentHistory = req.body?.messages');
  });
});
