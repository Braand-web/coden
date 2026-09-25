import { describe, expect, it } from 'vitest';
import { asksToExploreSite, classifyAttachment, extractUrls, formatBytes, MAX_FILE_BYTES, MAX_VIDEO_BYTES, refersToEarlierAttachment } from './attachment-policy';

describe('attachment policy', () => {
  it('accepts every announced type and names it', () => {
    const accepted = ['a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'a.gif', 'a.svg', 'a.mp4', 'a.mov', 'a.webm', 'a.pdf', 'a.docx', 'a.txt', 'a.md', 'a.csv', 'a.xlsx', 'a.json', 'a.ts', 'a.tsx', 'a.py', 'a.zip'];
    for (const name of accepted) expect(classifyAttachment(name, 1_000).ok, name).toBe(true);
    expect(classifyAttachment('a.mov', 10).ok && classifyAttachment('a.mov', 10)).toMatchObject({ kind: 'video', mime: 'video/quicktime' });
    expect(classifyAttachment('Plan.PDF', 10)).toMatchObject({ ok: true, kind: 'document' });
  });

  it('refuses other types with the list of what is accepted', () => {
    const verdict = classifyAttachment('setup.exe', 1_000);
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.error).toMatch(/n’est pas pris en charge.*PDF, DOCX/);
  });

  it('applies 20 Mo to images and files, 100 Mo to videos, with the size in the message', () => {
    expect(classifyAttachment('a.png', MAX_FILE_BYTES).ok).toBe(true);
    const image = classifyAttachment('photo.png', MAX_FILE_BYTES + 1);
    expect(!image.ok && image.error).toBe('« photo.png » pèse 20 Mo : la limite est de 20 Mo pour une image.');
    const file = classifyAttachment('brief.pdf', 25 * 1024 * 1024);
    expect(!file.ok && file.error).toMatch(/pèse 25 Mo : la limite est de 20 Mo pour un fichier/);
    expect(classifyAttachment('demo.mp4', MAX_VIDEO_BYTES).ok).toBe(true);
    const video = classifyAttachment('demo.mp4', MAX_VIDEO_BYTES + 1);
    expect(!video.ok && video.error).toMatch(/limite est de 100 Mo pour une vidéo/);
    expect(classifyAttachment('vide.txt', 0).ok).toBe(false);
  });

  it('refuses an image whose declared type is not an image', () => {
    expect(classifyAttachment('logo.png', 100, 'application/x-msdownload').ok).toBe(false);
    expect(classifyAttachment('logo.png', 100, 'application/octet-stream').ok).toBe(true);
  });

  it('formats sizes in French', () => {
    expect(formatBytes(512)).toBe('512 o');
    expect(formatBytes(2_048)).toBe('2 Ko');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1,5 Mo');
  });

  it('finds the links of a message, cleaned and without duplicates', () => {
    expect(extractUrls('Fais comme https://stripe.com/fr, et www.linear.app/features. Puis https://stripe.com/fr !')).toEqual([
      'https://stripe.com/fr',
      'https://www.linear.app/features',
    ]);
    expect(extractUrls('(voir https://example.org/page?x=1)')).toEqual(['https://example.org/page?x=1']);
    expect(extractUrls('pas de lien ici, juste example')).toEqual([]);
    expect(extractUrls('https://a.com https://b.com https://c.com https://d.com https://e.com https://f.com')).toHaveLength(5);
  });

  it('reads when a message asks to explore a site or points back at an attachment', () => {
    expect(asksToExploreSite('Explore aussi les pages internes de ce site')).toBe(true);
    expect(asksToExploreSite('Fais une page dans ce style')).toBe(false);
    expect(refersToEarlierAttachment('Refais le header comme sur l’image de tout à l’heure')).toBe(true);
    expect(refersToEarlierAttachment('Ajoute un bouton')).toBe(false);
  });
});
