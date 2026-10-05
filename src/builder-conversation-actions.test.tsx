// @vitest-environment happy-dom
import React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountBuilderConversation } from './builder-conversation-island';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let restoreDimensions: (() => void) | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  const oldScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  const oldClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() { return this.classList?.contains('coden-message-content') ? 180 : 0; },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() { return this.classList?.contains('coden-message-content') ? 60 : 0; },
  });
  restoreDimensions = () => {
    if (oldScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', oldScrollHeight);
    else delete (HTMLElement.prototype as any).scrollHeight;
    if (oldClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', oldClientHeight);
    else delete (HTMLElement.prototype as any).clientHeight;
  };
});

afterEach(() => {
  act(() => { window.dispatchEvent(new Event('beforeunload')); });
  host.remove();
  restoreDimensions?.();
  restoreDimensions = null;
  vi.restoreAllMocks();
});

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
}

describe('Builder conversation message actions', () => {
  it.each(['user', 'assistant', 'system'] as const)('keeps long %s messages complete without a truncation component', async role => {
    const text = Array.from({ length: 30 }, (_, index) => `Ligne ${index + 1}`).join('\n');
    let api!: ReturnType<typeof mountBuilderConversation>;
    act(() => {
      api = mountBuilderConversation(host);
      api.addMessage({ id: `long-${role}-message`, role, content: text });
    });
    await settle();

    const content = host.querySelector<HTMLElement>('.coden-message-content')!;
    expect(content.textContent).toContain('Ligne 1');
    expect(content.textContent).toContain('Ligne 30');
    expect(content.hasAttribute('data-collapsed')).toBe(false);
    expect(host.querySelector('.coden-message-expand')).toBeNull();
    expect(getComputedStyle(content).maxHeight).not.toBe('6.5em');
    expect(api.messages().find(message => message.id === `long-${role}-message`)?.content).toBe(text);
  });

  it('adds one independent toolbar without making short user bubbles a grid item', async () => {
    act(() => {
      const api = mountBuilderConversation(host, { onCopyLink: async () => true, onEditMessage: async () => undefined });
      api.addMessage({ id: 'short-user', role: 'user', content: 'salut', durableId: 'durable-short' });
      api.addMessage({ id: 'short-assistant', role: 'assistant', content: 'Bonjour' });
    });
    await settle();

    const user = host.querySelector<HTMLElement>('[data-message-id="short-user"]')!;
    const bubble = user.querySelector<HTMLElement>('.coden-chat-bubble')!;
    const footer = user.querySelector<HTMLElement>('.coden-message-footer')!;
    expect(bubble.textContent).toBe('salut');
    expect(bubble.contains(footer)).toBe(false);
    expect(user.querySelector('.coden-chat-userstack')?.classList.contains('coden-chat-message-stack')).toBe(false);
    expect(user.querySelectorAll('.coden-message-footer')).toHaveLength(1);
    expect(getComputedStyle(bubble).width).toBe('fit-content');
    expect(getComputedStyle(footer).alignSelf).toBe('flex-end');
    expect(getComputedStyle(footer).opacity).not.toBe('0');
    const assistantFooter = host.querySelector<HTMLElement>('[data-message-id="short-assistant"] .coden-message-footer')!;
    expect(getComputedStyle(assistantFooter).alignSelf).toBe('flex-start');
    expect(getComputedStyle(assistantFooter).justifyContent).toBe('flex-start');
  });

  it('keeps restored streaming text fully visible and copies every text part', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const first = 'Analyse complète.\n'.repeat(20);
    const last = 'Synthèse enregistrée';
    act(() => {
      const api = mountBuilderConversation(host);
      api.addMessage({ id: 'restored-stream', role: 'assistant', content: last });
      api.restoreChat('restored-stream', [
        { type: 'text_delta', delta: first },
        { type: 'text_end' },
        { type: 'text_delta', delta: last },
      ], 'done', last);
    });
    await settle();

    const message = host.querySelector<HTMLElement>('[data-message-id="restored-stream"]')!;
    expect(message.textContent).toContain('Analyse complète.');
    expect(message.textContent).toContain(last);
    expect(message.querySelector('[data-collapsed]')).toBeNull();
    expect(message.querySelectorAll('.coden-message-footer')).toHaveLength(1);
    await act(async () => { message.querySelector<HTMLButtonElement>('[aria-label="Copier le message"]')!.click(); });
    expect(writeText).toHaveBeenCalledWith(`${first}\n\n${last}`);
  });

  it('copies message text and private links, dates messages, and only edits user prompts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const onCopyLink = vi.fn().mockResolvedValue(true);
    const onEditMessage = vi.fn().mockResolvedValue(undefined);
    let api!: ReturnType<typeof mountBuilderConversation>;
    act(() => {
      api = mountBuilderConversation(host, { onCopyLink, onEditMessage });
      api.addMessage({ id: 'user-message', role: 'user', content: 'Ma demande initiale', durableId: 'durable-user-2', branchId: 'branch-a', createdAt: new Date().toISOString() });
      api.addMessage({ id: 'assistant-message', role: 'assistant', content: 'La réponse', durableId: 'durable-assistant-2', createdAt: new Date().toISOString() });
    });
    await settle();

    const user = host.querySelector<HTMLElement>('[data-message-id="user-message"]')!;
    expect(user.querySelector('.coden-message-time')?.textContent).toMatch(/Aujourd’hui|Today/);
    expect(user.querySelector('[aria-label="Modifier et relancer ce message"]')).not.toBeNull();
    const assistant = host.querySelector<HTMLElement>('[data-message-id="assistant-message"]')!;
    expect(assistant.querySelector('[aria-label="Modifier et relancer ce message"]')).toBeNull();

    await act(async () => { user.querySelector<HTMLButtonElement>('[aria-label="Copier le message"]')!.click(); });
    expect(writeText).toHaveBeenCalledWith('Ma demande initiale');
    await act(async () => { user.querySelector<HTMLButtonElement>('[aria-label="Copier le lien privé"]')!.click(); });
    expect(onCopyLink).toHaveBeenCalledOnce();

    act(() => user.querySelector<HTMLButtonElement>('[aria-label="Modifier et relancer ce message"]')!.click());
    const form = user.querySelector<HTMLFormElement>('.coden-message-edit')!;
    const textarea = form.querySelector<HTMLTextAreaElement>('textarea')!;
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      nativeValue.call(textarea, 'Demande corrigée');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(onEditMessage).toHaveBeenCalledWith(expect.objectContaining({ durableId: 'durable-user-2', branchId: 'branch-a' }), 'Demande corrigée');
  });

  it('keeps the edit form open with a recoverable error and busy state', async () => {
    let rejectEdit!: (error: Error) => void;
    const onEditMessage = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectEdit = reject; }));
    let api!: ReturnType<typeof mountBuilderConversation>;
    act(() => {
      api = mountBuilderConversation(host, { onEditMessage });
      api.addMessage({ id: 'user-message-error', role: 'user', content: 'Demande', durableId: 'durable-user-error' });
    });
    await settle();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Modifier et relancer ce message"]')!.click());
    const form = host.querySelector<HTMLFormElement>('.coden-message-edit')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(form.textContent).toContain('Relance…');
    await act(async () => { rejectEdit(new Error('temporary transport failure')); await Promise.resolve(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Impossible de relancer');
    expect(host.querySelector('.coden-message-edit')).not.toBeNull();
  });
});
