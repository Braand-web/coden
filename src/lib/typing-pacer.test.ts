import { describe, expect, it } from 'vitest';
import { createTypingPacer } from './typing-pacer';
import type { ChatEvent } from './agent-chat-protocol';

const text = (delta: string): ChatEvent => ({ type: 'text_delta', delta });
const said = (events: ChatEvent[]) => events.filter(e => e.type === 'text_delta').map(e => (e as any).delta).join('');

describe('typing pacer', () => {
  it('releases a burst at a steady rate rather than all at once', () => {
    const pacer = createTypingPacer(64);
    pacer.push(text('a'.repeat(100)));
    const first = pacer.drain(1000);
    expect(said(first).length).toBeGreaterThan(0);
    expect(said(first).length).toBeLessThan(100);
    // Half a second later, roughly 32 more characters are due.
    const second = pacer.drain(1500);
    expect(said(second).length).toBeGreaterThanOrEqual(30);
    expect(pacer.pending).toBe(true);
  });

  it('never lets a later event overtake text that is still being written', () => {
    const pacer = createTypingPacer(64);
    pacer.push(text('x'.repeat(200)));
    pacer.push({ type: 'files_touched', action: 'edit', paths: ['src/App.tsx'] });
    const released = pacer.drain(1000);
    // The tool line is behind 200 characters; it cannot be in the first tick.
    expect(released.some(event => event.type === 'files_touched')).toBe(false);
    expect(said(released).length).toBeLessThan(200);
  });

  it('lets an event through once the text ahead of it is done, and not before', () => {
    const pacer = createTypingPacer(64);
    pacer.push(text('short'));
    pacer.push({ type: 'files_touched', action: 'read', paths: ['a.ts'] });

    const released: ChatEvent[] = [];
    for (let t = 1000; t <= 1400 && pacer.pending; t += 50) released.push(...pacer.drain(t));

    expect(said(released)).toBe('short');
    // It comes out last, after every character it was queued behind.
    expect(released.at(-1)?.type).toBe('files_touched');
    expect(released.filter(event => event.type === 'files_touched')).toHaveLength(1);
  });

  it('loses not one character of what it was given', () => {
    const pacer = createTypingPacer(64);
    const chunks = ['Bonjour, ', 'je vais créer ', 'ton application.'];
    chunks.forEach(chunk => pacer.push(text(chunk)));
    let out = '';
    for (let t = 1000; t <= 3000; t += 50) out += said(pacer.drain(t));
    expect(out).toBe(chunks.join(''));
    expect(pacer.pending).toBe(false);
  });

  it('stops pacing the moment the run ends', () => {
    // Otherwise the message keeps writing itself after the spinner stopped —
    // and a backgrounded tab may never fire the tick that would finish it.
    const pacer = createTypingPacer(64);
    pacer.push(text('z'.repeat(500)));
    pacer.push({ type: 'run_finished', reason: 'completed' });
    const released = pacer.drain(1000);
    expect(said(released)).toBe('z'.repeat(500));
    expect(released.at(-1)?.type).toBe('run_finished');
    expect(pacer.pending).toBe(false);
  });

  it('does not dump the queue after a backgrounded tab', () => {
    const pacer = createTypingPacer(64);
    pacer.push(text('q'.repeat(5000)));
    pacer.drain(1000);
    // Five minutes with no tick.
    expect(said(pacer.drain(301_000)).length).toBeLessThanOrEqual(64);
  });

  it('starts a new run from nothing', () => {
    const pacer = createTypingPacer(64);
    pacer.push(text('stale'.repeat(50)));
    pacer.push({ type: 'run_started', messageId: 'm2' });
    const released = pacer.drain(1000);
    expect(said(released)).toBe('');
    expect(released[0]?.type).toBe('run_started');
  });

  it('flushes on demand without reordering', () => {
    const pacer = createTypingPacer(64);
    pacer.push(text('un'));
    pacer.push({ type: 'activity', label: 'construit' });
    pacer.push(text('deux'));
    expect(pacer.flush().map(e => e.type)).toEqual(['text_delta', 'activity', 'text_delta']);
  });
});
