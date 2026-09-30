import { describe, expect, it } from 'vitest';
import { attachmentAriaLabel, attachmentKindOf, displayFileName, fileMetaLine, fileTypeLabel, looksMachineMade, splitLegacyAttachmentText, truncateMiddle } from './attachment-display';

const HASH = 'An_k98OgMxubqE3Qawb2dGriS4br_LRTvnot_vkgTxOzRFdmgHEL42ROqSNH6fe4Fd24Y7KAtfdZB_xOJK5XNrBhzACy4LU6vuFptCyZ2tfX_6tW1U-5TEVes6RnrXRBHNJLN-uzlVPVh0ZtzijsD8cyN6xXVUIANsuPE8UkMN0e3N8QgFIsuIrBeAvZat5sY3jxY1oizx1A6RXOM3tU.jpeg';

describe('the name a person sees', () => {
  it('never shows the machine\'s name: the one in the bug report becomes « Image.jpeg »', () => {
    expect(looksMachineMade(HASH)).toBe(true);
    const shown = displayFileName({ name: HASH, mimeType: 'image/jpeg' });
    expect(shown.text).toBe('Image.jpeg');
    expect(shown.generated).toBe(true);
    expect(shown.text).not.toContain('k98Og');
    for (const key of ['3f2504e0-4f89-11d3-9a0c-0305e82c3301.png', 'a3f9c2d4e5b6a7c8d9e0f1a2b3c4d5e6f7a8b9c0.pdf', 'Xk3_9fQ-2LmZ8rTn_Vp4YcHs7Wd1AeBu.webp']) expect(looksMachineMade(key), key).toBe(true);
  });

  it('keeps every name a person would have typed', () => {
    for (const name of ['rapport-final-2024.pdf', 'Maquette accueil v3.png', 'budget_Q3_2025.xlsx', 'IMG_20240912_081512.jpg', 'Capture d’écran 2025-09-30 à 18.22.11.png', 'présentation commerciale très longue pour la réunion de lundi matin.pptx']) {
      expect(looksMachineMade(name), name).toBe(false);
      expect(displayFileName({ name }).text, name).toBe(name);
    }
  });

  it('a pasted screenshot has no name of its own: « Image collée » or « Capture d\'écran », with the time', () => {
    const at = new Date(2026, 8, 30, 18, 22, 5);
    expect(displayFileName({ name: 'image.png', mimeType: 'image/png', createdAt: at }).text).toBe('Image collée · 18 h 22');
    expect(displayFileName({ name: '', mimeType: 'image/png', createdAt: at }).text).toBe('Image collée · 18 h 22');
    expect(displayFileName({ name: 'Screenshot.png', mimeType: 'image/png', createdAt: at }).text).toBe('Capture d’écran · 18 h 22');
    expect(displayFileName({ name: 'image.png', mimeType: 'image/png' }).text).toBe('Image collée');
    expect(displayFileName({ name: 'blob', mimeType: 'application/pdf' }).text).toBe('Document');
  });

  it('cuts the middle and keeps the extension', () => {
    const long = `${'a-very-long-report-title-'.repeat(8)}final-version.pdf`;
    expect(long.length).toBeGreaterThan(200);
    const short = truncateMiddle(long, 34);
    expect(short.length).toBeLessThanOrEqual(34);
    expect(short).toContain('…');
    expect(short.endsWith('.pdf')).toBe(true);
    expect(truncateMiddle('short.png', 34)).toBe('short.png');
    const noExtension = truncateMiddle('un-nom-tres-long-sans-aucune-extension-du-tout-vraiment', 30);
    expect(noExtension.length).toBeLessThanOrEqual(30);
    expect(noExtension).toContain('…');
  });

  it('types and sizes read like a person would say them', () => {
    expect(fileTypeLabel({ mimeType: 'image/jpeg' })).toBe('JPEG');
    expect(fileTypeLabel({ name: 'a.xlsx' })).toBe('Excel');
    expect(fileTypeLabel({ name: 'a.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe('Word');
    expect(fileTypeLabel({ name: 'a.zip' })).toBe('ZIP');
    expect(fileTypeLabel({ name: 'notes' })).toBe('Fichier');
    expect(fileMetaLine({ name: 'a.jpeg', mimeType: 'image/jpeg', size: 245_000 })).toBe('JPEG · 239 Ko');
    expect(fileMetaLine({ name: 'a.pdf', size: 3_400_000 })).toBe('PDF · 3,2 Mo');
    expect(fileMetaLine({ name: 'a.pdf' })).toBe('PDF');
  });

  it('knows what kind of thing it is from the type, the extension or what the server said', () => {
    expect(attachmentKindOf({ mimeType: 'image/gif' })).toBe('image');
    expect(attachmentKindOf({ name: 'x.heic' })).toBe('image');
    expect(attachmentKindOf({ name: 'x.pdf' })).toBe('document');
    expect(attachmentKindOf({ name: 'x.zip' })).toBe('archive');
    expect(attachmentKindOf({ name: 'x.xlsx' })).toBe('spreadsheet');
    expect(attachmentKindOf({ name: 'x.unknown' })).toBe('file');
  });

  it('a screen reader hears the name, the type and the size', () => {
    expect(attachmentAriaLabel({ name: HASH, mimeType: 'image/jpeg', size: 245_000 })).toBe('Image.jpeg, JPEG, 239 Ko');
    expect(attachmentAriaLabel({ name: 'devis.pdf', size: 12_000 }, 'analysé')).toBe('devis.pdf, PDF, 12 Ko, analysé');
  });

  it('older messages that carried their files as text are split back into words and names', () => {
    expect(splitLegacyAttachmentText('que vois tu\n\n📎 a.png · b.pdf')).toEqual({ text: 'que vois tu', names: ['a.png', 'b.pdf'] });
    expect(splitLegacyAttachmentText('rien de joint')).toEqual({ text: 'rien de joint', names: [] });
    expect(splitLegacyAttachmentText(`que vois tu\n\n📎 ${HASH}`).names).toEqual([HASH]);
  });
});

describe('one line, cut in the middle by the browser', () => {
  it('keeps the extension in the tail and the start in the head', async () => {
    const { splitForMiddleEllipsis } = await import('./attachment-display');
    expect(splitForMiddleEllipsis('rapport-financier-trimestriel-final.xlsx')).toEqual({ head: 'rapport-financier-trimestriel-f', tail: 'inal.xlsx' });
    expect(splitForMiddleEllipsis('a.pdf')).toEqual({ head: 'a.pdf', tail: '' });
    expect(splitForMiddleEllipsis('LISEZMOI')).toEqual({ head: 'LISEZMOI', tail: '' });
  });
});

describe('the original name wins', () => {
  it('keeps a camera name and any name the person chose', () => {
    expect(displayFileName({ name: 'IMG_4412.jpg', mimeType: 'image/jpeg' }).text).toBe('IMG_4412.jpg');
    expect(displayFileName({ name: 'photo-1.png', mimeType: 'image/png' }).text).toBe('photo-1.png');
    expect(displayFileName({ name: 'data.csv', mimeType: 'text/csv' }).text).toBe('data.csv');
  });
});
