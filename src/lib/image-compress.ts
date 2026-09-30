/**
 * Shrinks a picture in the browser before it is sent.
 *
 * A phone screenshot or a design export is 2 to 8 MB of pixels the models never
 * use: the server re-encodes every image to a bounded JPEG for vision anyway
 * (sharp, 1 600 px), so the extra bytes only cost upload time on a mobile link.
 * Sending a 2 000 px WebP instead makes the upload several times shorter
 * without changing what any agent sees.
 *
 * Deliberately conservative — a wrong compression is worse than a slow upload:
 *  - only PNG, JPEG and WebP; a GIF may be animated and an SVG is text;
 *  - a picture already small (≤ 350 KB and ≤ 2 000 px) is sent as it is;
 *  - the original is kept unless the result is at least 15 % smaller;
 *  - the alpha channel survives (WebP, or PNG where WebP cannot be encoded);
 *  - any failure (no OffscreenCanvas, a decode error) sends the original.
 */

export const COMPRESS_MAX_SIDE = 2_000;
export const COMPRESS_MIN_BYTES = 350 * 1024;
export const COMPRESS_MIN_GAIN = 0.85;
const COMPRESSIBLE = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type CompressionPlan = { compress: false; reason: string } | { compress: true; width: number; height: number; scale: number };

/** Pure decision: should this picture be re-encoded, and at what size. */
export function planCompression(input: { type: string; size: number; width: number; height: number }): CompressionPlan {
  if (!COMPRESSIBLE.has(input.type)) return { compress: false, reason: 'format' };
  if (!(input.width > 0) || !(input.height > 0)) return { compress: false, reason: 'dimensions' };
  const longest = Math.max(input.width, input.height);
  if (input.size <= COMPRESS_MIN_BYTES && longest <= COMPRESS_MAX_SIDE) return { compress: false, reason: 'already-small' };
  const scale = longest > COMPRESS_MAX_SIDE ? COMPRESS_MAX_SIDE / longest : 1;
  return { compress: true, width: Math.max(1, Math.round(input.width * scale)), height: Math.max(1, Math.round(input.height * scale)), scale };
}

/** Whether the re-encoded picture is worth sending instead of the original. */
export const worthKeeping = (originalBytes: number, compressedBytes: number) => compressedBytes > 0 && compressedBytes <= originalBytes * COMPRESS_MIN_GAIN;

const EXTENSION: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };

/** The file name with the extension of its new format, so the server's content check still agrees. */
export function renamedFor(name: string, mime: string): string {
  const extension = EXTENSION[mime];
  if (!extension) return name;
  const stem = name.replace(/\.[^./\\]+$/, '') || 'image';
  return `${stem}.${extension}`;
}

export type CompressionResult = { file: File; compressed: boolean; originalBytes: number; bytes: number; reason?: string };

/**
 * The file to upload: a smaller picture when that is safe, otherwise the file
 * unchanged. Never throws.
 */
export async function compressImageForUpload(file: File): Promise<CompressionResult> {
  const unchanged = (reason: string): CompressionResult => ({ file, compressed: false, originalBytes: file.size, bytes: file.size, reason });
  try {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return unchanged('unsupported');
    if (!COMPRESSIBLE.has(file.type)) return unchanged('format');
    // A small file needs no decoding at all to be ruled out.
    if (file.size <= COMPRESS_MIN_BYTES * 0.5) return unchanged('already-small');
    const bitmap = await createImageBitmap(file);
    try {
      const plan = planCompression({ type: file.type, size: file.size, width: bitmap.width, height: bitmap.height });
      if (!plan.compress) return unchanged(plan.reason);
      const canvas = new OffscreenCanvas(plan.width, plan.height);
      const context = canvas.getContext('2d');
      if (!context) return unchanged('no-context');
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, plan.width, plan.height);
      // WebP keeps transparency and is the smallest; a browser that cannot
      // encode it answers with PNG, which the size check below then judges.
      let blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
      if (blob.type !== 'image/webp' && file.type === 'image/jpeg') blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
      if (!worthKeeping(file.size, blob.size)) return unchanged('not-smaller');
      const type = blob.type || 'image/webp';
      return { file: new File([blob], renamedFor(file.name, type), { type, lastModified: file.lastModified }), compressed: true, originalBytes: file.size, bytes: blob.size };
    } finally {
      bitmap.close?.();
    }
  } catch {
    return unchanged('error');
  }
}
