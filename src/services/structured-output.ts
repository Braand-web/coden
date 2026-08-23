export class StructuredOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StructuredOutputError';
  }
}

function extractJsonObject(text: string) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) return cleaned;
  return cleaned.match(/\{[\s\S]*\}/)?.[0] || '';
}

export function parseStructuredObject<T extends Record<string, unknown>>(
  text: string,
  validate: (value: unknown) => value is T,
): T {
  const candidate = extractJsonObject(text);
  if (!candidate) throw new StructuredOutputError('The model did not return a JSON object.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new StructuredOutputError('The model returned invalid JSON.');
  }
  if (!validate(parsed)) throw new StructuredOutputError('The model JSON did not match the required contract.');
  return parsed;
}

export async function parseOrRepairStructuredObject<T extends Record<string, unknown>>(
  text: string,
  validate: (value: unknown) => value is T,
  repair: (invalidText: string) => Promise<string>,
): Promise<T> {
  try {
    return parseStructuredObject(text, validate);
  } catch {
    return parseStructuredObject(await repair(text), validate);
  }
}
