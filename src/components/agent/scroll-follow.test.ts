// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountBuilderConversation } from '../../builder-conversation-island';
import type { AgentEnvelope, ChatEvent } from '../../lib/agent-chat-protocol';

/**
 * The reader's hand against the glide.
 *
 * While a reply streams, the conversation follows the newest text. Found in a
 * real browser: a reader who scrolled up to re-read was pulled back down at
 * once, because the follow-glide restarted on every update and its own scroll
 * events counted as "back at the bottom". These pin the behaviour the fix gave
 * it — following, letting go when the reader scrolls up, coming back when they
 * return to the bottom or send something.
 *
 * happy-dom has no layout, so these pin the contract of the interaction; the
 * measurement that found the bug and shows it fixed (a wheel-up of 800 px undone
 * within 30 ms before, held after) is `node scripts/stream-scenarios.mjs scroll`
 * against a real Chromium.
 */
const envelope = (seq: number, payload: ChatEvent): AgentEnvelope => ({ runId: 'run-1', messageId: 'm1', seq, timestamp: seq, type: payload.type, channel: 'chat', payload });

let host: HTMLElement;
let api: ReturnType<typeof mountBuilderConversation>;
let contentHeight = 300;
const VIEW = 300;
let renderErrors: string[];

beforeEach(() => {
  renderErrors = [];
  const reportError = console.error.bind(console);
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (/Maximum update depth exceeded/.test(String(args[0]))) {
      if (!renderErrors.length) renderErrors.push(new Error(String(args[0])).stack || String(args[0]));
    } else reportError(...args);
  });
  window.sessionStorage.clear();
  contentHeight = 300;
  host = document.createElement('div');
  Object.defineProperty(host, 'scrollHeight', { get: () => contentHeight, configurable: true });
  Object.defineProperty(host, 'clientHeight', { get: () => VIEW, configurable: true });
  let top = 0;
  Object.defineProperty(host, 'scrollTop', { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, Math.max(0, contentHeight - VIEW))); }, configurable: true });
  document.body.appendChild(host);
  api = mountBuilderConversation(host, {});
});

afterEach(() => {
  api.clear();
  host.remove();
  vi.restoreAllMocks();
  expect(renderErrors).toEqual([]);
});

const grow = (by: number) => { contentHeight += by; };
// Real time: the follow is a glide over animation frames, and React renders on its own scheduler.
const tick = (ms = 90) => new Promise<void>(resolve => setTimeout(resolve, ms));
const bottom = () => contentHeight - VIEW;
const scrollTo = (top: number) => { host.scrollTop = top; host.dispatchEvent(new Event('scroll')); };

function stream() {
  const id = api.addMessage({ role: 'assistant', content: '' });
  api.startLiveRun(id);
  let seq = 0;
  return async (text: string, by = 120) => { api.applyChatEvent(id, envelope(++seq, { type: 'text_delta', delta: text })); grow(by); await tick(); };
}

describe('following a streaming reply', () => {
  it('lets go when the reader scrolls up, and does not pull them back down', async () => {
    const push = stream();
    for (let i = 0; i < 5; i += 1) await push('Une phrase assez longue pour remplir la ligne. '.repeat(3));
    const before = host.scrollTop;
    // The reader wheels up to re-read.
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -600 }));
    scrollTo(Math.max(0, before - 500));
    const parked = host.scrollTop;
    for (let i = 0; i < 8; i += 1) await push('La réponse continue de s’écrire pendant ce temps. '.repeat(3));
    expect(host.scrollTop).toBe(parked);
  });

  it('follows again once the reader is back at the bottom', async () => {
    const push = stream();
    for (let i = 0; i < 4; i += 1) await push('Texte de remplissage pour la hauteur. '.repeat(4));
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -400 }));
    scrollTo(20);
    await push('Encore du texte. '.repeat(4));
    expect(host.scrollTop).toBe(20);
    // Back to the bottom by hand.
    scrollTo(bottom());
    for (let i = 0; i < 3; i += 1) await push('Et le texte suit de nouveau. '.repeat(4));
    expect(host.scrollTop).toBeGreaterThan(bottom() - 130);
  });

  it('a touch drag downward (the finger pulling content down) also lets go', async () => {
    const push = stream();
    for (let i = 0; i < 4; i += 1) await push('Texte de remplissage pour la hauteur. '.repeat(4));
    const touch = (clientY: number) => ({ touches: [{ clientY }] });
    host.dispatchEvent(Object.assign(new Event('touchstart'), touch(200)));
    host.dispatchEvent(Object.assign(new Event('touchmove'), touch(320)));
    scrollTo(Math.max(0, host.scrollTop - 250));
    const parked = host.scrollTop;
    for (let i = 0; i < 4; i += 1) await push('Le flux continue. '.repeat(4));
    expect(host.scrollTop).toBe(parked);
  });

  it('does not mistake the browser pulling the position up, when the content gets shorter, for the reader', async () => {
    const push = stream();
    for (let i = 0; i < 4; i += 1) await push('Texte de remplissage pour la hauteur. '.repeat(4));
    await tick(350);
    // The content shrinks (a block re-rendered shorter): the browser clamps the position on its own.
    contentHeight -= 200;
    host.scrollTop = Math.min(host.scrollTop, contentHeight - VIEW);
    host.dispatchEvent(new Event('scroll'));
    await push('Le flux continue après le raccourcissement. '.repeat(4));
    await push('Et encore un peu. '.repeat(4));
    await tick(350);
    expect(host.dataset.follow).not.toBe('off');
    expect(host.scrollTop).toBeGreaterThan(bottom() - 130);
  });

  it('sending a new message brings the reader back to the bottom', async () => {
    const push = stream();
    for (let i = 0; i < 4; i += 1) await push('Texte de remplissage pour la hauteur. '.repeat(4));
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -400 }));
    scrollTo(10);
    api.addMessage({ role: 'user', content: 'Et maintenant, ajoute une page contact.' });
    grow(80);
    await tick(350);
    expect(host.scrollTop).toBeGreaterThan(bottom() - 130);
  });
});
