import { describe, expect, it } from 'vitest';
import { COMPRESS_MAX_SIDE, compressImageForUpload, planCompression, renamedFor, worthKeeping } from './image-compress';

describe('client-side image compression', () => {
  it('shrinks a large screenshot to the bounded side, keeping its ratio', () => {
    const plan = planCompression({ type: 'image/png', size: 4_200_000, width: 3_000, height: 1_500 });
    expect(plan).toEqual({ compress: true, width: 2_000, height: 1_000, scale: 2_000 / 3_000 });
  });

  it('re-encodes a heavy picture that is not too wide, without resizing it', () => {
    const plan = planCompression({ type: 'image/jpeg', size: 3_000_000, width: 1_600, height: 900 });
    expect(plan).toMatchObject({ compress: true, width: 1_600, height: 900, scale: 1 });
  });

  it('leaves alone what is already small, and what it must not touch', () => {
    expect(planCompression({ type: 'image/png', size: 120_000, width: 800, height: 600 })).toEqual({ compress: false, reason: 'already-small' });
    // A GIF may be animated; an SVG is text; a HEIC cannot be read by every browser.
    for (const type of ['image/gif', 'image/svg+xml', 'image/heic']) {
      expect(planCompression({ type, size: 5_000_000, width: 4_000, height: 3_000 })).toEqual({ compress: false, reason: 'format' });
    }
    expect(planCompression({ type: 'image/png', size: 5_000_000, width: 0, height: 0 })).toEqual({ compress: false, reason: 'dimensions' });
    expect(COMPRESS_MAX_SIDE).toBe(2_000);
  });

  it('keeps the original unless the result is clearly smaller', () => {
    expect(worthKeeping(1_000_000, 400_000)).toBe(true);
    expect(worthKeeping(1_000_000, 900_000)).toBe(false);
    expect(worthKeeping(1_000_000, 0)).toBe(false);
  });

  it('renames to the new format so the server’s content check still agrees', () => {
    expect(renamedFor('capture écran.png', 'image/webp')).toBe('capture écran.webp');
    expect(renamedFor('photo.final.jpeg', 'image/jpeg')).toBe('photo.final.jpg');
    expect(renamedFor('logo', 'image/webp')).toBe('logo.webp');
    expect(renamedFor('x.bmp', 'image/bmp')).toBe('x.bmp');
  });

  it('never throws and sends the original where the browser cannot decode', async () => {
    // Node has neither createImageBitmap nor OffscreenCanvas, like an old browser.
    const file = new File([new Uint8Array(900_000)], 'big.png', { type: 'image/png' });
    const result = await compressImageForUpload(file);
    expect(result).toMatchObject({ compressed: false, originalBytes: 900_000, bytes: 900_000, reason: 'unsupported' });
    expect(result.file).toBe(file);
  });
});
