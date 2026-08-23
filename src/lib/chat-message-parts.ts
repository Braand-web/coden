export type CodenMessagePart = {
  type: string;
  text?: string;
  [key: string]: unknown;
};

export type RedactText = (value: string) => string;

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\u0000/g, '').trim();
}

export function messagePartsFromContent(content: unknown): CodenMessagePart[] {
  const text = cleanText(content);
  return text ? [{ type: 'text', text }] : [];
}

export function normalizeMessageParts(parts: unknown, fallbackContent: unknown = ''): CodenMessagePart[] {
  if (!Array.isArray(parts)) return messagePartsFromContent(fallbackContent);

  const normalized = parts
    .map((part): CodenMessagePart | null => {
      if (!part || typeof part !== 'object') return null;
      const record = part as Record<string, unknown>;
      const type = cleanText(record.type);
      if (!type) return null;

      if (type === 'text' || type === 'reasoning') {
        const text = cleanText(record.text);
        return text ? { ...record, type, text } as CodenMessagePart : null;
      }

      return { ...record, type } as CodenMessagePart;
    })
    .filter((part): part is CodenMessagePart => Boolean(part));

  return normalized.length ? normalized : messagePartsFromContent(fallbackContent);
}

export function messageTextFromParts(parts: unknown, fallbackContent: unknown = '') {
  const text = normalizeMessageParts(parts, fallbackContent)
    .filter(part => part.type === 'text' || part.type === 'reasoning')
    .map(part => cleanText(part.text))
    .filter(Boolean)
    .join('\n')
    .trim();
  return text || cleanText(fallbackContent);
}

export function redactMessageParts(parts: unknown, redactText: RedactText): CodenMessagePart[] {
  return normalizeMessageParts(parts).map(part => {
    const next: CodenMessagePart = { ...part };
    if (typeof next.text === 'string') next.text = redactText(next.text);
    if (typeof next.error === 'string') next.error = redactText(next.error);
    if (typeof next.result === 'string') next.result = redactText(next.result);
    return next;
  });
}
