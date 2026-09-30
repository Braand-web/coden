import { describe, expect, it } from 'vitest';
import { dedupeTwinMessages, isTwinMessage } from './message-dedupe';

const at = (seconds: number) => new Date(Date.parse('2026-09-30T10:00:00Z') + seconds * 1000).toISOString();
const reply = (id: string, seconds: number, extra: Record<string, unknown> = {}, content = 'Bonjour ! Comment puis-je t’aider avec ton projet ?') => ({ id, role: 'assistant', content, created_at: at(seconds), ...extra });

describe('the same answer saved twice', () => {
  it('is recognised: same words, seconds apart, different ids', () => {
    expect(isTwinMessage(reply('a', 0), reply('b', 3, { ai_message_id: 'x' }))).toBe(true);
  });

  it('keeps one, the richer — the one with the client id and the stream', () => {
    const plain = reply('a', 0);
    const rich = reply('b', 3, { ai_message_id: 'iCMiSpt4m6Bo9S8InXkmN', metadata: { coden_stream: { events: [] } } });
    expect(dedupeTwinMessages([plain, rich])).toEqual([rich]);
    expect(dedupeTwinMessages([rich, plain])).toEqual([rich]);
  });

  it('never merges what is not a twin', () => {
    expect(isTwinMessage(reply('a', 0), reply('b', 600))).toBe(false); // the same thing, much later
    expect(isTwinMessage(reply('a', 0), reply('b', 2, {}, 'Autre réponse tout à fait différente.'))).toBe(false);
    expect(isTwinMessage(reply('a', 0, {}, 'Oui'), reply('b', 1, {}, 'Oui'))).toBe(false); // too short to tell
    expect(isTwinMessage({ ...reply('a', 0), role: 'user' }, { ...reply('b', 1), role: 'user' })).toBe(false);
  });

  it('ignores spacing differences and keeps the order of the others', () => {
    const list = [reply('u', -5, {}, 'Question de l’utilisateur ici'), reply('a', 0), reply('b', 2, {}, 'Bonjour !  Comment puis-je t’aider avec ton projet ?'), reply('c', 30, {}, 'Une vraie nouvelle réponse, plus loin.')];
    expect(dedupeTwinMessages(list).map(message => message.id)).toEqual(['u', 'a', 'c']);
  });

  it('survives messages without a date', () => {
    expect(dedupeTwinMessages([{ role: 'assistant', content: 'Une réponse assez longue.' }, { role: 'assistant', content: 'Une réponse assez longue.' }])).toHaveLength(2);
  });
});

describe('where it is applied', () => {
  it('on write, on the snapshot, and on both message listings', async () => {
    const { readFileSync } = await import('node:fs');
    const server = readFileSync('server.ts', 'utf8');
    expect(server).toMatch(/isTwinMessage\(candidate, row\)/);
    expect(server).toMatch(/isTwinMessage\(existing, input\.item\)/);
    expect(server.match(/dedupeTwinMessages\(/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
