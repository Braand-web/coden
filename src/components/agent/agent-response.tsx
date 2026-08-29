'use client';

import { Response } from '../ui/response';

export function AgentResponse({ content, streaming = false }: { content: string; streaming?: boolean }) {
  if (!content) return null;
  return <Response className="coden-agent-response" isStreaming={streaming}>{content}</Response>;
}
