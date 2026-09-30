// @vitest-environment happy-dom
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_VISIBLE_IMAGES, MessageAttachments, type MessageAttachment } from './message-attachments';
import { clearAttachmentCache } from '../../lib/attachment-resolve';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', () => ({ apiFetch }));

/*
 * The attachments of a message, as a person meets them: thumbnails in a grid with « +N », compact file cards with their own
 * name cut in the middle, a full-screen preview that the keyboard drives, and a clean state when something is missing.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  clearAttachmentCache();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.querySelectorAll('.coden-att-lightbox').forEach(node => node.remove());
  vi.unstubAllGlobals();
});

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const image = (name: string, extra: Partial<MessageAttachment> = {}): MessageAttachment => ({ name, mimeType: 'image/png', size: 120_000, kind: 'image', previewUrl: PIXEL, ...extra });
const render = (items: MessageAttachment[]) => act(() => root.render(<MessageAttachments items={items} />));
const key = (name: string) => act(() => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true })); });

describe('message attachments', () => {
  it('draws nothing for no attachment', () => {
    render([]);
    expect(container.querySelector('.coden-att-stack')).toBeNull();
  });

  it('shows an image as a thumbnail, never as a file name', () => {
    render([image('maquette.png')]);
    expect(container.querySelectorAll('.coden-att-tile')).toHaveLength(1);
    expect(container.querySelector('.coden-att-tile img')?.getAttribute('loading')).toBe('lazy');
    expect(container.querySelector('.coden-att-file')).toBeNull();
    expect(container.querySelector('.coden-att-tile')?.getAttribute('aria-label')).toBe('Agrandir l’image');
    expect(container.textContent).not.toContain('maquette');
  });

  it('never prints a machine-made name: a hash becomes « Image.jpeg »', () => {
    const hashed = 'An_k98OgQw7Zx3VbN2mP5LrT8cYd0HsJe4K_1xWuF.jpeg';
    render([{ name: hashed, mimeType: 'application/pdf', size: 52_000 }]);
    const text = container.textContent || '';
    expect(text).not.toContain('An_k98Og');
    expect(container.querySelector('.coden-att-name')?.textContent).toBe('Image.jpeg');
  });

  it('never names a picture: no file name on the tile, in its tooltip or in the preview', () => {
    render([image('IMG_4412.png')]);
    expect(container.textContent).not.toContain('IMG_4412');
    expect(container.querySelector('.coden-att-tile')?.getAttribute('title')).toBeNull();
  });

  it('cuts a 200-character name in the middle: the head gives way, the extension stays', () => {
    const long = `${'rapport-financier-trimestriel-'.repeat(7).slice(0, 196)}.xlsx`;
    render([{ name: long, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 2_400_000 }]);
    const name = container.querySelector('.coden-att-name')!;
    expect(name.querySelector('.coden-att-mid-tail')?.textContent).toMatch(/\.xlsx$/);
    expect(name.textContent).toBe(long);
    expect(name.getAttribute('title')).toBe(long);
  });

  it('keeps a name without extension whole when short', () => {
    render([{ name: 'LISEZMOI', mimeType: 'text/plain', size: 300 }]);
    expect(container.querySelector('.coden-att-name')?.textContent).toBe('LISEZMOI');
  });

  it('shows other files as compact single-line cards with type and size in grey', () => {
    render([
      { name: 'cahier-des-charges.pdf', mimeType: 'application/pdf', size: 1_258_291 },
      { name: 'budget.xlsx', size: 88_000 },
      { name: 'sources.zip', mimeType: 'application/zip', size: 5_000_000 },
    ]);
    const cards = [...container.querySelectorAll('.coden-att-file')];
    expect(cards).toHaveLength(3);
    const metas = [...container.querySelectorAll('.coden-att-meta')].map(node => node.textContent || '');
    expect(metas[0]).toMatch(/PDF/);
    expect(metas[0]).toMatch(/Mo/);
    expect(metas[2]).toMatch(/ZIP|Archive/i);
    expect(new Set([...container.querySelectorAll('.coden-att-icon')].map(node => node.getAttribute('data-kind'))).size).toBe(3);
  });

  it('makes a file a link to open or download when its original is known, and a plain card otherwise', () => {
    render([
      { name: 'a.pdf', mimeType: 'application/pdf', size: 10, fullUrl: 'https://files.example/a.pdf' },
      { name: 'b.pdf', mimeType: 'application/pdf', size: 10 },
    ]);
    const cards = container.querySelectorAll('.coden-att-file');
    expect(cards[0].tagName).toBe('A');
    expect(cards[0].getAttribute('download')).toBe('a.pdf');
    expect(cards[0].getAttribute('rel')).toContain('noopener');
    expect(cards[1].tagName).toBe('SPAN');
  });

  it('puts images first, then the files, in separate groups', () => {
    render([{ name: 'a.pdf', mimeType: 'application/pdf', size: 10 }, image('photo.jpg')]);
    const children = [...container.querySelector('.coden-att-stack')!.children].map(node => node.className);
    expect(children).toEqual(['coden-att-images', 'coden-att-files']);
  });

  it('lays several images out as a grid and folds the rest into « +N »', () => {
    render(Array.from({ length: 10 }, (_, index) => image(`photo-${index + 1}.png`)));
    expect(container.querySelectorAll('.coden-att-tile')).toHaveLength(MAX_VISIBLE_IMAGES);
    expect(container.querySelector('.coden-att-images')?.getAttribute('data-count')).toBe(String(MAX_VISIBLE_IMAGES));
    expect(container.querySelector('.coden-att-more')?.textContent).toBe('+7');
    const last = container.querySelectorAll('.coden-att-tile')[MAX_VISIBLE_IMAGES - 1];
    expect(last.getAttribute('aria-label')).toContain('7 autres');
  });

  it('handles ten files at once without losing one', () => {
    render(Array.from({ length: 10 }, (_, index) => ({ name: `piece-${index + 1}.pdf`, mimeType: 'application/pdf', size: 1000 * (index + 1) })));
    expect(container.querySelectorAll('.coden-att-file')).toHaveLength(10);
  });

  it('shows a broken image cleanly', () => {
    render([image('cassee.png')]);
    const img = container.querySelector('.coden-att-tile img')!;
    act(() => { img.dispatchEvent(new window.Event('error')); });
    expect(container.querySelector('.coden-att-broken')?.textContent).toContain('Aperçu indisponible');
    expect(container.querySelector('.coden-att-tile')?.getAttribute('data-state')).toBe('broken');
  });

  it('shows a skeleton until the picture has loaded, then reveals it', () => {
    render([image('lente.png')]);
    expect(container.querySelector('.coden-att-skeleton')).not.toBeNull();
    expect(container.querySelector('.coden-att-tile')?.getAttribute('data-state')).toBe('loading');
    const img = container.querySelector('.coden-att-tile img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 1200, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    act(() => { img.dispatchEvent(new window.Event('load')); });
    expect(container.querySelector('.coden-att-skeleton')).toBeNull();
    expect(container.querySelector('.coden-att-tile')?.getAttribute('data-state')).toBe('ready');
  });

  it('clamps a panorama and a portrait so the bubble keeps a sensible height', () => {
    render([image('pano.png')]);
    const img = container.querySelector('.coden-att-tile img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 6000, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 400, configurable: true });
    act(() => { img.dispatchEvent(new window.Event('load')); });
    expect((container.querySelector('.coden-att-tile') as HTMLElement).style.aspectRatio).toMatch(/^1\.9/);
  });

  it('says that an image is being analysed, discreetly', () => {
    render([image('capture.png', { analysis: 'pending' })]);
    expect(container.querySelector('.coden-att-analysing')?.textContent).toContain('Analyse de l’image…');
  });

  it('shows an upload in progress and a failed file on their card', () => {
    render([{ name: 'gros.zip', mimeType: 'application/zip', size: 9_000_000, status: 'uploading' }, { name: 'casse.pdf', mimeType: 'application/pdf', size: 1, status: 'failed', error: 'Lecture impossible' }]);
    const metas = [...container.querySelectorAll('.coden-att-meta')];
    expect(metas[0].textContent).toContain('Envoi');
    expect(metas[1].textContent).toContain('Lecture impossible');
    expect(metas[1].getAttribute('data-tone')).toBe('error');
  });

  it('gives each card a screen-reader label with name, type and size', () => {
    render([{ name: 'contrat.pdf', mimeType: 'application/pdf', size: 1_500_000 }]);
    const label = container.querySelector('.coden-att-file')?.getAttribute('aria-label') || '';
    expect(label).toContain('contrat.pdf');
    expect(label).toMatch(/PDF/);
    expect(label).toMatch(/Mo/);
  });

  it('shows an old message that only kept a name as a card, not as an empty tile', () => {
    render([{ name: 'ancienne-photo.jpg' }]);
    expect(container.querySelector('.coden-att-tile')).toBeNull();
    expect(container.querySelector('.coden-att-file')).not.toBeNull();
  });

  describe('full-screen preview', () => {
    const three = () => [image('un.png'), image('deux.png'), image('trois.png')];

    it('opens on click, counts the images, and closes with Échap, returning the focus', () => {
      render(three());
      const first = container.querySelector<HTMLButtonElement>('.coden-att-tile')!;
      act(() => { first.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
      const dialog = document.body.querySelector('[role="dialog"]')!;
      expect(dialog.getAttribute('aria-modal')).toBe('true');
            expect(dialog.getAttribute('aria-label')).toContain('1 sur 3');
      key('Escape');
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });

    it('moves between images with the arrows, wrapping around', () => {
      render(three());
      act(() => { container.querySelector('.coden-att-tile')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
      const name = () => document.body.querySelector('.coden-att-lightbox-name')?.textContent;
      expect(name()).toBe('Image 1 sur 3');
      key('ArrowRight');
      expect(name()).toBe('Image 2 sur 3');
      key('ArrowLeft');
      key('ArrowLeft');
      expect(name()).toBe('Image 3 sur 3');
    });

    it('zooms with + and −, never below 100 % nor above 400 %, and offers a download', () => {
      render([image('seule.png', { fullUrl: 'https://files.example/seule.png' })]);
      act(() => { container.querySelector('.coden-att-tile')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
      const value = () => document.body.querySelector('.coden-att-lightbox-tools .is-value')?.textContent;
      expect(value()).toBe('100 %');
      key('+');
      expect(value()).toBe('150 %');
      for (let i = 0; i < 10; i += 1) key('+');
      expect(value()).toBe('400 %');
      for (let i = 0; i < 10; i += 1) key('-');
      expect(value()).toBe('100 %');
      const download = document.body.querySelector<HTMLAnchorElement>('.coden-att-lightbox-tools a')!;
      expect(download.getAttribute('href')).toBe('https://files.example/seule.png');
      expect(download.getAttribute('download')).toBe('seule.png');
      expect(document.body.querySelector('.coden-att-lightbox-nav')).toBeNull();
    });

    it('shows a clean message when the original cannot be shown', () => {
      render([image('perdue.png')]);
      act(() => { container.querySelector('.coden-att-tile')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
      act(() => { document.body.querySelector('.coden-att-lightbox-stage img')!.dispatchEvent(new window.Event('error')); });
      expect(document.body.querySelector('.coden-att-lightbox-broken')?.textContent).toContain('ne peut pas être affichée');
    });

    it('opens on the tile that was clicked, including the « +N » one', () => {
      render(Array.from({ length: 6 }, (_, index) => image(`p${index + 1}.png`)));
      const tiles = container.querySelectorAll('.coden-att-tile');
      act(() => { tiles[MAX_VISIBLE_IMAGES - 1].dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
      expect(document.body.querySelector('.coden-att-lightbox-name')?.textContent).toBe(`Image ${MAX_VISIBLE_IMAGES} sur 6`);
          });
  });

  it('fetches thumbnails by id for a message reloaded from history, and shows an unavailable one cleanly', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const gone = '22222222-2222-4222-8222-222222222222';
    apiFetch.mockResolvedValue({ success: true, attachments: [{ id, name: 'plan.png', mimeType: 'image/png', size: 5000, kind: 'image', status: 'ready', thumbnailUrl: PIXEL, downloadUrl: 'https://files.example/plan.png' }] });
    await act(async () => { root.render(<MessageAttachments items={[{ id, name: 'plan.png', mimeType: 'image/png', kind: 'image' }, { id: gone, name: 'disparue.png', mimeType: 'image/png', kind: 'image' }]} />); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    const tiles = container.querySelectorAll('.coden-att-tile');
    expect(tiles).toHaveLength(2);
    expect(tiles[0].querySelector('img')?.getAttribute('src')).toBe(PIXEL);
    expect(tiles[1].getAttribute('data-state')).toBe('broken');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(apiFetch.mock.calls[0][1].body).ids).toEqual([id, gone]);
  });
});
