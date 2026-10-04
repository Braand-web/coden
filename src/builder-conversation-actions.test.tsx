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
  it('reveals the actions on hover or keyboard focus and keeps them available on touch devices', async () => {
    let api!: ReturnType<typeof mountBuilderConversation>;
    act(() => {
      api = mountBuilderConversation(host);
      api.addMessage({ id: 'hover-user-message', role: 'user', content: 'Demande', durableId: 'durable-hover-1' });
    });
    await settle();

    const message = host.querySelector<HTMLElement>('[data-message-id="hover-user-message"]')!;
    const footer = message.querySelector<HTMLElement>('.coden-message-footer')!;
    expect(getComputedStyle(footer).opacity).toBe('0');
    const copyButton = message.querySelector<HTMLButtonElement>('[aria-label="Copier le message"]')!;
    copyButton.focus();
    expect(document.activeElement).toBe(copyButton);

    const styles = [...document.querySelectorAll('style')].map(style => style.textContent || '').join('\n');
    expect(styles).toContain('.coden-chat-message:hover .coden-message-footer');
    expect(styles).toContain('.coden-chat-message:focus-within .coden-message-footer');
    expect(styles).toContain('@media (hover: none), (pointer: coarse)');
    expect(styles).toContain('.coden-message-footer { transition: none; }');
  });

  it('sizes short user bubbles to their content while retaining a maximum width', async () => {
    let api!: ReturnType<typeof mountBuilderConversation>;
    act(() => {
      api = mountBuilderConversation(host);
      api.addMessage({ id: 'short-user-message', role: 'user', content: 'ok' });
    });
    await settle();

    const bubble = host.querySelector<HTMLElement>('[data-message-id="short-user-message"] .coden-chat-bubble');
    expect(bubble?.textContent).toContain('ok');
    const styles = [...document.querySelectorAll('style')].map(style => style.textContent || '').join('\n');
    expect(styles).toMatch(/\.coden-chat-message\.user \.coden-chat-bubble\s*\{[^}]*width:\s*fit-content;/s);
    expect(styles).toMatch(/\.coden-chat-message\.user \.coden-chat-bubble\s*\{[^}]*max-width:\s*min\(86%,\s*520px\);/s);
  });

  it('collapses long messages and expands them with an accessible control', async () => {
    let api!: ReturnType<typeof mountBuilderConversation>;
    act(() => {
      api = mountBuilderConversation(host);
      api.addMessage({ id: 'long-user-message', role: 'user', content: 'Ligne 1\nLigne 2\nLigne 3\nLigne 4\nLigne 5', durableId: 'durable-user-1' });
    });
    await settle();

    const content = host.querySelector<HTMLElement>('.coden-message-content')!;
    const expand = host.querySelector<HTMLButtonElement>('.coden-message-expand')!;
    expect(content.dataset.collapsed).toBe('true');
    expect(expand.textContent).toBe('Afficher plus');
    act(() => expand.click());
    expect(content.dataset.collapsed).toBe('false');
    expect(expand.getAttribute('aria-expanded')).toBe('true');
    expect(expand.textContent).toBe('Afficher moins');
    act(() => expand.click());
    expect(expand.textContent).toBe('Afficher plus');
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
