// @vitest-environment happy-dom
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptInput } from './ai-chat-input';
import type { AttachmentUploader, RemoteAttachment } from '../../lib/attachment-types';
import { primeModelAvailability } from '../../lib/model-availability';

/*
 * The composer's attachments, as a user meets them: choose or drop files,
 * see each one upload and get read, remove one, send — and the host gets the
 * ids to put in the request. Links written in the message get their card.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // The model menu asks the server what it can run; nothing to ask here.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"models":[]}', { headers: { 'content-type': 'application/json' } })));
  (URL as any).createObjectURL ??= () => 'blob:preview';
  (URL as any).revokeObjectURL ??= () => undefined;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const settle = async (ms = 0) => { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); };

function fakeUploader() {
  const remote = (patch: Partial<RemoteAttachment>): RemoteAttachment => ({ id: 'id', kind: 'document', name: '', mimeType: '', size: 0, status: 'ready', error: null, summary: '', sourceUrl: null, preview: null, thumbnailUrl: null, ...patch });
  let count = 0;
  const uploader: AttachmentUploader = {
    upload: vi.fn(async (file: File, onProgress: (fraction: number) => void) => { onProgress(0.5); onProgress(1); count += 1; return remote({ id: `file-${count}`, name: file.name, status: 'processing' }); }),
    status: vi.fn(async (id: string) => remote({ id, status: 'ready', summary: 'Lu' })),
    remove: vi.fn(async () => undefined),
    previewLink: vi.fn(async () => ({ ok: true as const, title: 'Stripe', description: '', siteName: 'stripe.com', favicon: '', image: '' })),
    analyzeLink: vi.fn(async (url: string) => remote({ id: 'link-1', kind: 'link', sourceUrl: url, status: 'ready', preview: { title: 'Stripe' } })),
  };
  return uploader;
}

function choose(files: File[]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  act(() => { input.dispatchEvent(new window.Event('change', { bubbles: true })); });
}

describe('composer attachments', () => {
  it('accepts every announced type through the + button', () => {
    act(() => root.render(<PromptInput defaultExpanded uploader={fakeUploader()} />));
    const accept = container.querySelector<HTMLInputElement>('input[type="file"]')!.accept;
    for (const type of ['.png', '.svg', '.mp4', '.mov', '.webm', '.pdf', '.docx', '.xlsx', '.csv', '.md', '.json', '.zip', '.tsx']) expect(accept).toContain(type);
    expect(container.querySelector('[data-prompt-action="upload"]')?.getAttribute('aria-label')).toBe('Joindre des fichiers');
  });

  it('uploads, reads, and hands the ids to the host on send', async () => {
    const uploader = fakeUploader();
    const onSubmit = vi.fn();
    act(() => root.render(<PromptInput defaultExpanded uploader={uploader} onSubmit={onSubmit} value="Crée une app à partir du brief" />));
    choose([new File(['# Brief'], 'brief.md', { type: 'text/markdown' }), new File(['a,b'], 'data.csv', { type: 'text/csv' })]);
    await settle(50);
    await settle(800);
    const names = [...container.querySelectorAll('.coden-attach-name')].map(node => node.textContent);
    expect(names).toEqual(['brief.md', 'data.csv']);
    expect(container.querySelector('.coden-attach-sub')?.textContent).toContain('Markdown');
    const send = container.querySelector<HTMLButtonElement>('.coden-prompt-submit')!;
    await act(async () => { send.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    expect(onSubmit).toHaveBeenCalledOnce();
    const [text, meta] = onSubmit.mock.calls[0];
    expect(text).toBe('Crée une app à partir du brief');
    expect(meta.attachmentIds).toEqual(['file-1', 'file-2']);
    expect(meta.attachments).toEqual([]);
    expect(meta.attachmentNames).toEqual(['brief.md', 'data.csv']);
    expect(container.querySelectorAll('.coden-attach-chip')).toHaveLength(0);
  });

  it('refuses an unsupported or oversized file with a clear sentence', async () => {
    act(() => root.render(<PromptInput defaultExpanded uploader={fakeUploader()} />));
    const huge = new File(['x'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(huge, 'size', { value: 25 * 1024 * 1024 });
    choose([new File(['MZ'], 'setup.exe'), huge]);
    await settle();
    const message = container.querySelector('.coden-attach-errors')?.textContent || '';
    expect(message).toContain('« setup.exe » n’est pas pris en charge');
    expect(message).toContain('« photo.png » pèse 25 Mo : la limite est de 20 Mo pour une image.');
    expect(container.querySelectorAll('.coden-attach-chip')).toHaveLength(0);
  });

  it('removes a file with its ✕ and deletes it on the server', async () => {
    const uploader = fakeUploader();
    act(() => root.render(<PromptInput defaultExpanded uploader={uploader} />));
    choose([new File(['a'], 'a.txt', { type: 'text/plain' })]);
    await settle(50);
    await act(async () => { container.querySelector<HTMLButtonElement>('.coden-attach-remove')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    expect(container.querySelectorAll('.coden-attach-chip')).toHaveLength(0);
    expect(uploader.remove).toHaveBeenCalledWith('file-1');
  });

  it('keeps the files in the browser when there is no session', async () => {
    const onSubmit = vi.fn();
    act(() => root.render(<PromptInput defaultExpanded onSubmit={onSubmit} value="Une vitrine" />));
    const file = new File(['a'], 'logo.svg', { type: 'image/svg+xml' });
    choose([file]);
    await settle();
    expect(container.querySelector('.coden-attach-sub')?.textContent).toContain('Image SVG');
    await act(async () => { container.querySelector<HTMLButtonElement>('.coden-prompt-submit')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    expect(onSubmit.mock.calls[0][1].attachments).toEqual([file]);
    expect(onSubmit.mock.calls[0][1].attachmentIds).toEqual([]);
  });

  it('turns a link in the message into an analysed card', async () => {
    const uploader = fakeUploader();
    act(() => root.render(<PromptInput defaultExpanded uploader={uploader} value="Fais une page dans le style de https://stripe.com" />));
    await settle(700);
    await settle(50);
    const card = container.querySelector('.coden-attach-chip.is-link');
    expect(card?.querySelector('.coden-attach-name')?.textContent).toBe('Stripe');
    expect(card?.querySelector('.coden-attach-sub')?.textContent).toContain('page analysée');
    expect(uploader.analyzeLink).toHaveBeenCalledWith('https://stripe.com/', expect.any(String));
  });

  it('warns when the chosen model cannot see, and offers one that can', async () => {
    primeModelAvailability({ models: [
      { id: 'moonshotai/kimi-k3', available: true, supports_vision: false },
      { id: 'google/gemini-3.8-flash', available: true, supports_vision: true },
    ] });
    const onModelChange = vi.fn();
    act(() => root.render(<PromptInput defaultExpanded uploader={fakeUploader()} model="moonshotai/kimi-k3" onModelChange={onModelChange} plan="free" />));
    await settle(20);
    choose([new File(['png'], 'maquette.png', { type: 'image/png' })]);
    await settle(50);
    const notice = container.querySelector('.coden-attach-notice');
    expect(notice?.textContent).toContain('Kimi K3 ne lit pas les images');
    const button = notice!.querySelector('button')!;
    expect(button.textContent).toBe('Utiliser Gemini 3.8 Flash');
    await act(async () => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    expect(onModelChange).toHaveBeenCalledWith('google/gemini-3.8-flash');
  });

  it('adds a pasted screenshot', async () => {
    act(() => root.render(<PromptInput defaultExpanded uploader={fakeUploader()} />));
    const textarea = container.querySelector('textarea')!;
    const pasted = new File(['png'], 'image.png', { type: 'image/png' });
    const event = new window.Event('paste', { bubbles: true, cancelable: true }) as any;
    event.clipboardData = { files: [pasted] };
    await act(async () => { textarea.dispatchEvent(event); });
    await settle(50);
    expect(container.querySelector('.coden-attach-name')?.textContent).toMatch(/^capture-\d{6}\.png$/);
  });
});
