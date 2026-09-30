/**
 * How an attachment is named, typed and sized for a person.
 *
 * One place, used by the conversation, the composer's tray and the history, so a file is called the same thing
 * everywhere:
 *  - the name the person gave it, cut in the middle so the extension stays visible;
 *  - never the machine's name for it: an identifier, a hash, a storage key is replaced by a plain word
 *    (« Image », « Document ») — and a pasted screenshot, which has no name of its own, by « Capture d'écran »
 *    or « Image collée » with the time;
 *  - a short type label and a size, for the grey line under the name.
 */
import { classifyAttachment, fileExtension, formatBytes, type AttachmentKind } from './attachment-policy';

export type AttachmentDisplayInput = {
  name?: string;
  mimeType?: string;
  size?: number;
  kind?: string;
  createdAt?: string | number | Date;
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp', 'heic', 'heif']);
const NAMELESS = /^(?:blob|unnamed|untitled|sans titre|download)(?:[\s._-]*\(?\d+\)?)?$/i;
const GENERIC_NAMES = /^(?:image|pasted image|pasted-image|screenshot|screen shot|capture|capture d'ecran|capture d’écran)(?:[\s._-]*\(?\d+\)?)?$/i;

/** The part of a name before its last extension (when the extension is a real one). */
export function splitName(name: string): { base: string; extension: string } {
  const text = String(name || '').trim();
  const dot = text.lastIndexOf('.');
  if (dot <= 0 || dot === text.length - 1) return { base: text, extension: '' };
  const extension = text.slice(dot + 1);
  return /^[a-z0-9]{1,8}$/i.test(extension) ? { base: text.slice(0, dot), extension } : { base: text, extension: '' };
}

/**
 * A name a machine made: a storage key, a content hash, a CDN identifier — long, no space, letters and digits
 * mixed with underscores and dashes, nothing a person would type.
 */
export function looksMachineMade(name: string): boolean {
  const { base } = splitName(name);
  const text = base.trim();
  if (text.length < 28 || /\s/.test(text)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return true;
  if (/^[0-9a-f]{24,}$/i.test(text)) return true;
  if (!/^[A-Za-z0-9_\-+=.]+$/.test(text)) return false;
  const digits = (text.match(/\d/g) || []).length;
  const upper = (text.match(/[A-Z]/g) || []).length;
  const lower = (text.match(/[a-z]/g) || []).length;
  const separators = (text.match(/[_\-]/g) || []).length;
  // Words have vowels and spaces or long runs of lower-case letters; a key mixes cases and digits all through.
  return upper >= 4 && lower >= 4 && (digits >= 2 || separators >= 3);
}

export function attachmentKindOf(input: AttachmentDisplayInput): AttachmentKind | 'file' {
  const mime = String(input.mimeType || '').toLowerCase();
  const extension = fileExtension(input.name || '');
  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.has(extension) || input.kind === 'image') return 'image';
  if (mime.startsWith('video/') || input.kind === 'video') return 'video';
  const verdict = classifyAttachment(input.name || '', input.size || 1, mime);
  if (verdict.ok) return verdict.kind;
  // No usable extension (a pasted or downloaded blob): the type the browser reported says enough.
  if (/pdf|wordprocessingml|msword|presentationml|ms-powerpoint/.test(mime)) return 'document';
  if (/spreadsheetml|ms-excel|^text\/csv$/.test(mime)) return 'spreadsheet';
  if (/zip|x-7z|x-rar|tar|gzip/.test(mime)) return 'archive';
  if (/^application\/json$/.test(mime)) return 'code';
  if (mime.startsWith('text/')) return 'text';
  return (['document', 'spreadsheet', 'text', 'code', 'archive', 'link'] as const).find(kind => kind === input.kind) || 'file';
}

const FALLBACK_LABEL: Record<AttachmentKind | 'file', string> = {
  image: 'Image', video: 'Vidéo', document: 'Document', spreadsheet: 'Tableur', text: 'Texte', code: 'Code', archive: 'Archive', link: 'Lien', file: 'Fichier',
};

function timeOf(value: AttachmentDisplayInput['createdAt']): string {
  if (value === undefined || value === null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
}

/**
 * What the file is called on screen: the person's name when it is one, a plain word when it is not.
 * `full` keeps the extension; `short` is for one line and cuts the middle (see `truncateMiddle`).
 */
export function displayFileName(input: AttachmentDisplayInput): { text: string; original: string; generated: boolean } {
  const original = String(input.name || '').trim();
  const kind = attachmentKindOf(input);
  const { base, extension } = splitName(original);
  const suffix = extension ? `.${extension.toLowerCase()}` : '';
  // « data.csv », « document.pdf » are names a person chose; only a picture called « image » or « capture » is a blob to rename.
  if (!original || NAMELESS.test(base.trim()) || (kind === 'image' && GENERIC_NAMES.test(base.trim()))) {
    const time = timeOf(input.createdAt);
    const pasted = kind === 'image' && (!original || /^(?:image|img|pasted|blob|capture|screenshot|screen shot)/i.test(base.trim()));
    const label = pasted ? (/^(?:screenshot|screen shot|capture)/i.test(base.trim()) ? 'Capture d’écran' : 'Image collée') : FALLBACK_LABEL[kind];
    return { text: time ? `${label} · ${time}` : label, original, generated: true };
  }
  if (looksMachineMade(original)) return { text: `${FALLBACK_LABEL[kind]}${suffix}`, original, generated: true };
  return { text: original, original, generated: false };
}

/** Cut the middle with « … » so the end — the extension — stays visible: `rapport-tresl…final.pdf`. */
export function truncateMiddle(text: string, max = 34): string {
  const value = String(text || '');
  if (value.length <= max || max < 8) return value;
  const { extension } = splitName(value);
  const tail = extension ? Math.min(extension.length + 1 + 6, Math.floor(max / 2)) : Math.floor((max - 1) / 3);
  const head = max - tail - 1;
  return `${value.slice(0, Math.max(1, head)).trimEnd()}…${value.slice(value.length - tail)}`;
}

const TYPE_LABELS: Array<[RegExp, string]> = [
  [/^image\/jpe?g$/, 'JPEG'], [/^image\/png$/, 'PNG'], [/^image\/gif$/, 'GIF'], [/^image\/webp$/, 'WebP'], [/^image\/svg/, 'SVG'], [/^image\/avif$/, 'AVIF'], [/^image\/hei[cf]$/, 'HEIC'],
  [/^application\/pdf$/, 'PDF'], [/wordprocessingml|msword/, 'Word'], [/spreadsheetml|ms-excel/, 'Excel'], [/presentationml|ms-powerpoint/, 'PowerPoint'],
  [/^text\/csv$/, 'CSV'], [/^text\/markdown$/, 'Markdown'], [/^application\/json$/, 'JSON'], [/^text\/plain$/, 'Texte'], [/zip|x-7z|x-rar|tar|gzip/, 'ZIP'],
  [/^video\/mp4$/, 'MP4'], [/^video\/quicktime$/, 'MOV'], [/^video\/webm$/, 'WebM'],
];

/** « JPEG », « PDF », « Excel »… for the grey line. */
export function fileTypeLabel(input: AttachmentDisplayInput): string {
  const mime = String(input.mimeType || '').toLowerCase();
  for (const [pattern, label] of TYPE_LABELS) if (pattern.test(mime)) return label;
  const extension = fileExtension(input.name || '');
  const byExtension: Record<string, string> = { jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WebP', pdf: 'PDF', doc: 'Word', docx: 'Word', xls: 'Excel', xlsx: 'Excel', ppt: 'PowerPoint', pptx: 'PowerPoint', csv: 'CSV', md: 'Markdown', txt: 'Texte', json: 'JSON', zip: 'ZIP', rar: 'ZIP', '7z': 'ZIP', mp4: 'MP4', mov: 'MOV', webm: 'WebM' };
  if (byExtension[extension]) return byExtension[extension];
  return extension ? extension.toUpperCase() : FALLBACK_LABEL[attachmentKindOf(input)];
}

export function fileSizeLabel(size?: number): string {
  return Number.isFinite(size) && (size as number) > 0 ? formatBytes(size as number).replace(/\./g, ',') : '';
}

/** « JPEG · 240 Ko »: the grey line under a name. */
export function fileMetaLine(input: AttachmentDisplayInput): string {
  return [fileTypeLabel(input), fileSizeLabel(input.size)].filter(Boolean).join(' · ');
}

/** What a screen reader says: name, type, size. */
export function attachmentAriaLabel(input: AttachmentDisplayInput, extra = ''): string {
  const name = displayFileName(input).text;
  return [name, fileMetaLine(input).replace(' · ', ', '), extra].filter(Boolean).join(', ');
}

/**
 * Older messages carried their attachments as text: `…\n\n📎 a.png · b.pdf`. Split them out so they are drawn as
 * attachments (by name only — there is no id to fetch a preview with) and the bubble keeps only the words.
 */
export function splitLegacyAttachmentText(content: string): { text: string; names: string[] } {
  const match = /\n{1,2}📎\s*([^\n]+)\s*$/u.exec(String(content || ''));
  if (!match) return { text: String(content || ''), names: [] };
  const names = match[1].split(/\s+·\s+/).map(name => name.trim()).filter(Boolean);
  return { text: String(content).slice(0, match.index).trimEnd(), names };
}

/**
 * A name in two pieces for a one-line cut in the middle done by the browser: the head gives way (« … »), the tail —
 * the extension and a few letters before it — never does, whatever the width of the card.
 */
export function splitForMiddleEllipsis(text: string): { head: string; tail: string } {
  const value = String(text || '');
  const { extension } = splitName(value);
  const keep = extension ? extension.length + 1 + 4 : 0;
  if (value.length <= keep + 6) return { head: value, tail: '' };
  return { head: value.slice(0, value.length - keep), tail: value.slice(value.length - keep) };
}
