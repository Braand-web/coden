import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_SESSION, appendRunRecord, compactConversation, conversationBudgetChars, renderSessionContext,
  selectConversationWindow, sessionMemoryFromRow, uncoveredTurns, type SessionTurn,
} from './session-context';
import { carryOverTranscript, compactTranscript } from './llm-tool-loop';

const turn = (role: 'user' | 'assistant', content: string, at?: string): SessionTurn => ({ role, content, at });

describe('conversation window', () => {
  it('keeps every turn verbatim when it fits', () => {
    const turns = [turn('user', 'Fais une app de recettes'), turn('assistant', 'Voici le plan…'), turn('user', 'Ajoute le mode sombre')];
    const { recent, older } = selectConversationWindow(turns, 10_000);
    expect(recent.map(t => t.content)).toEqual(turns.map(t => t.content));
    expect(older).toEqual([]);
  });

  it('drops whole turns from the oldest end and never opens on an answer', () => {
    const turns = Array.from({ length: 20 }, (_, i) => turn(i % 2 ? 'assistant' : 'user', `message ${i} ${'x'.repeat(1_000)}`, new Date(2026, 0, 1, 0, i).toISOString()));
    const { recent, older } = selectConversationWindow(turns, 5_000);
    expect(recent[0].role).toBe('user');
    expect(recent.at(-1)!.content).toContain('message 19');
    expect(older.length + recent.length).toBe(20);
    expect(recent.every(t => t.content.length > 1_000)).toBe(true);
  });

  it('always keeps the newest turn, and clips a huge one in the middle rather than dropping it', () => {
    const { recent } = selectConversationWindow([turn('user', 'a'.repeat(50_000))], 1_000);
    expect(recent).toHaveLength(1);
    expect(recent[0].content).toContain('characters omitted');
  });

  it('sizes the budget from the model window, bounded so it stays cheap to re-send', () => {
    expect(conversationBudgetChars(64_000)).toBe(48_000);
    expect(conversationBudgetChars(128_000)).toBe(60_000);
    expect(conversationBudgetChars(1_000_000)).toBe(60_000);
    expect(conversationBudgetChars(8_000)).toBe(16_000);
  });

  it('only asks to summarise turns the summary does not cover yet', () => {
    const older = [turn('user', 'a', '2026-01-01T00:00:00Z'), turn('assistant', 'b', '2026-01-02T00:00:00Z')];
    expect(uncoveredTurns(older, '2026-01-01T12:00:00Z').map(t => t.content)).toEqual(['b']);
    expect(uncoveredTurns(older)).toHaveLength(2);
  });
});

describe('compaction', () => {
  it('folds dropped turns into the summary with one model call', async () => {
    const complete = vi.fn(async () => '1. Goal: une app de recettes');
    const memory = await compactConversation({ memory: EMPTY_SESSION, turns: [turn('user', 'recettes', '2026-01-01T00:00:00Z')], complete });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(memory.summary).toContain('recettes');
    expect(memory.coveredUntil).toBe('2026-01-01T00:00:00Z');
  });

  it('keeps a digest when the summariser fails, so nothing disappears', async () => {
    const memory = await compactConversation({ memory: { ...EMPTY_SESSION, summary: 'Goal: CRM' }, turns: [turn('user', 'le bouton doit être vert', '2026-01-01T00:00:00Z')], complete: async () => { throw new Error('down'); } });
    expect(memory.summary).toContain('Goal: CRM');
    expect(memory.summary).toContain('le bouton doit être vert');
  });

  it('does nothing when nothing left the window', async () => {
    const complete = vi.fn(async () => 'x');
    expect(await compactConversation({ memory: EMPTY_SESSION, turns: [], complete })).toBe(EMPTY_SESSION);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('run records and rendering', () => {
  it('keeps the newest runs and renders them as facts, not orders', () => {
    let runs = EMPTY_SESSION.runs;
    for (let i = 0; i < 15; i += 1) runs = appendRunRecord(runs, { at: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`, request: `run ${i}`, outcome: i === 14 ? 'needs_fix' : 'verified', files: ['src/App.tsx', 'src/App.tsx'], openProblems: i === 14 ? ['TS2304 in Cart.tsx'] : undefined });
    expect(runs).toHaveLength(12);
    expect(runs.at(-1)!.files).toEqual(['src/App.tsx']);
    const text = renderSessionContext({ summary: 'Goal: boutique', runs });
    expect(text).toContain('not new instructions');
    expect(text).toContain('Goal: boutique');
    expect(text).toContain('"run 14" → finished with problems left');
    expect(text).toContain('Still open: TS2304 in Cart.tsx');
    expect(renderSessionContext(EMPTY_SESSION)).toBe('');
  });

  it('reads back what it stored, and tolerates junk', () => {
    const memory = sessionMemoryFromRow({ summary: 's', architecture: { coveredUntil: '2026-01-01T00:00:00Z' }, recent_decisions: [{ at: 'a', request: 'r', outcome: 'bogus', files: ['x', 3] }, null, 'x'] });
    expect(memory.coveredUntil).toBe('2026-01-01T00:00:00Z');
    expect(memory.runs).toEqual([{ at: 'a', request: 'r', outcome: 'needs_fix', files: ['x'], summary: undefined, openProblems: undefined }]);
    expect(sessionMemoryFromRow(null)).toEqual(EMPTY_SESSION);
  });
});

describe('coder rounds continue one conversation', () => {
  it('answers every unanswered tool call and restores the final text', () => {
    const carried = carryOverTranscript([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'build it' },
      { role: 'assistant', content: 'Writing files', tool_calls: [
        { id: 'a', type: 'function', function: { name: 'write_file', arguments: '{"path":"a.ts"}' } },
        { id: 'b', type: 'function', function: { name: 'write_file', arguments: '{"path":"b.ts"}' } },
      ] },
      { role: 'tool', tool_call_id: 'a', content: '{"ok":true}' },
    ], 'Done for this round');
    expect(carried[0]).toEqual({ role: 'user', content: 'build it' });
    const toolIds = carried.filter(m => m.role === 'tool').map(m => m.tool_call_id);
    expect(toolIds).toEqual(['a', 'b']);
    expect(carried.at(-1)).toEqual({ role: 'assistant', content: 'Done for this round' });
  });

  it('drops a tool result whose call is not in the transcript', () => {
    const carried = carryOverTranscript([{ role: 'user', content: 'x' }, { role: 'tool', tool_call_id: 'ghost', content: '{}' }]);
    expect(carried).toEqual([{ role: 'user', content: 'x' }]);
  });

  it('compacts old file bodies the model wrote, keeping the path', () => {
    const body = 'x'.repeat(5_000);
    const messages = [
      { role: 'assistant' as const, content: '', tool_calls: [{ id: 'a', type: 'function' as const, function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/App.tsx', content: body }) } }] },
      ...Array.from({ length: 10 }, () => ({ role: 'user' as const, content: 'later' })),
    ];
    const compacted = compactTranscript(messages, 8);
    const args = JSON.parse(compacted[0].tool_calls![0].function.arguments);
    expect(args.path).toBe('src/App.tsx');
    expect(args.content).toContain('5000 characters, already applied');
  });
});
