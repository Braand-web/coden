/*
 * A small thumbnail made in the browser when an image is chosen.
 *
 * The message shows it at once, without waiting for the server and without the full-size file: about 320 px on the
 * long side, JPEG (PNG and GIF keep their transparency as WebP/PNG when small), a few kilobytes. It is also what is kept
 * in the conversation while the signed link is being fetched.
 */
export const THUMB_MAX_SIDE = 320;

export async function makeImageThumbnail(file: Blob, maxSide = THUMB_MAX_SIDE): Promise<string | undefined> {
  if (typeof document === 'undefined' || !/^image\//i.test(file.type || '')) return undefined;
  try {
    const bitmap = typeof createImageBitmap === 'function' ? await createImageBitmap(file) : await loadImage(file);
    const width = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width;
    const height = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height;
    if (!width || !height) return undefined;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.drawImage(bitmap as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
    const transparent = /png|gif|webp|svg/i.test(file.type);
    return canvas.toDataURL(transparent ? 'image/webp' : 'image/jpeg', 0.82);
  } catch {
    return undefined;
  }
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable image')); };
    image.src = url;
  });
}
