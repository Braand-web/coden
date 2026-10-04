export type ConversationMessageRecord = {
  id?: string;
  ai_message_id?: string;
  role?: string;
  content?: string;
  created_at?: string;
  metadata?: Record<string, any> | null;
};

export function conversationMessageKey(message: ConversationMessageRecord) {
  return String(message.ai_message_id || message.id || '');
}

function branchMetadata(message: ConversationMessageRecord) {
  const value = message.metadata?.coden_branch;
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function sortMessages(messages: ConversationMessageRecord[]) {
  return [...messages].sort((left, right) => {
    const time = String(left.created_at || '').localeCompare(String(right.created_at || ''));
    return time || conversationMessageKey(left).localeCompare(conversationMessageKey(right));
  });
}

/**
 * Resolve the visible transcript for a branch. A branch replaces the source
 * user message, so its prefix ends immediately before that message; the source
 * branch itself remains untouched and can still be opened by its own link.
 */
export function resolveConversationBranch(
  source: ConversationMessageRecord[],
  branchId?: string | null,
  throughMessageId?: string | null,
): ConversationMessageRecord[] {
  const messages = sortMessages(source);
  const resolving = new Set<string>();

  const resolve = (id?: string | null): ConversationMessageRecord[] => {
    if (!id) return messages.filter(message => !branchMetadata(message)?.id);
    if (resolving.has(id)) return [];
    resolving.add(id);
    const own = messages.filter(message => branchMetadata(message)?.id === id);
    if (!own.length) return [];

    const firstBranch = own[0];
    const meta = branchMetadata(firstBranch) || {};
    const parentBranchId = typeof meta.parent_branch_id === 'string' ? meta.parent_branch_id : null;
    const parentMessageId = typeof meta.parent_message_id === 'string' ? meta.parent_message_id : null;
    let prefix = resolve(parentBranchId);
    if (parentMessageId) {
      const forkIndex = prefix.findIndex(message =>
        conversationMessageKey(message) === parentMessageId || message.id === parentMessageId || message.ai_message_id === parentMessageId,
      );
      prefix = forkIndex >= 0 ? prefix.slice(0, forkIndex) : [];
    }
    resolving.delete(id);
    return [...prefix, ...own];
  };

  const resolved = resolve(branchId);
  if (!throughMessageId) return resolved;
  const targetIndex = resolved.findIndex(message =>
    conversationMessageKey(message) === throughMessageId || message.id === throughMessageId || message.ai_message_id === throughMessageId,
  );
  return targetIndex < 0 ? [] : resolved.slice(0, targetIndex + 1);
}

export function branchMetadataForMessage(
  metadata: Record<string, any> | null | undefined,
  branchId?: string | null,
  fork?: { parentBranchId?: string | null; parentMessageId?: string | null },
) {
  const next = { ...(metadata || {}) };
  if (!branchId) return next;
  next.coden_branch = {
    id: branchId,
    ...(fork ? {
      parent_branch_id: fork.parentBranchId || null,
      parent_message_id: fork.parentMessageId || null,
    } : {}),
  };
  return next;
}
