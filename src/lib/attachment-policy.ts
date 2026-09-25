/**
 * What a message can carry, and how big it may be.
 *
 * One file for both sides: the composer refuses a file with the sentence the
 * server would have answered, and the server checks again (the browser's word
 * about a type or a size is never taken on trust).
 */

export type AttachmentKind = 'image' | 'video' | 'document' | 'spreadsheet' | 'text' | 'code' | 'archive' | 'link';

type Rule = { kind: AttachmentKind; mime: string; label: string };

/* Extension first: browsers report no type, or a wrong one, for .md, .ts, .mov on some systems. */
const RULES: Record<string, Rule> = {
  png: { kind: 'image', mime: 'image/png', label: 'Image PNG' },
  jpg: { kind: 'image', mime: 'image/jpeg', label: 'Image JPG' },
  jpeg: { kind: 'image', mime: 'image/jpeg', label: 'Image JPG' },
  webp: { kind: 'image', mime: 'image/webp', label: 'Image WEBP' },
  gif: { kind: 'image', mime: 'image/gif', label: 'Image GIF' },
  svg: { kind: 'image', mime: 'image/svg+xml', label: 'Image SVG' },
  mp4: { kind: 'video', mime: 'video/mp4', label: 'Vidéo MP4' },
  mov: { kind: 'video', mime: 'video/quicktime', label: 'Vidéo MOV' },
  webm: { kind: 'video', mime: 'video/webm', label: 'Vidéo WEBM' },
  pdf: { kind: 'document', mime: 'application/pdf', label: 'PDF' },
  docx: { kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word' },
  xlsx: { kind: 'spreadsheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel' },
  csv: { kind: 'spreadsheet', mime: 'text/csv', label: 'CSV' },
  txt: { kind: 'text', mime: 'text/plain', label: 'Texte' },
  md: { kind: 'text', mime: 'text/markdown', label: 'Markdown' },
  json: { kind: 'code', mime: 'application/json', label: 'JSON' },
  zip: { kind: 'archive', mime: 'application/zip', label: 'Archive ZIP' },
};

/* Source code, read as text. */
const CODE_EXTENSIONS = [
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro',
  'py', 'rb', 'php', 'java', 'kt', 'swift', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cs', 'dart', 'sql', 'sh', 'bash',
  'yml', 'yaml', 'toml', 'xml', 'graphql', 'gql', 'prisma', 'env.example', 'ini',
];
for (const extension of CODE_EXTENSIONS) {
  RULES[extension] ??= { kind: 'code', mime: 'text/plain', label: `Code ${extension.toUpperCase()}` };
}

export const MB = 1024 * 1024;
/** 20 Mo par image ou fichier, 100 Mo par vidéo. */
export const MAX_FILE_BYTES = 20 * MB;
export const MAX_VIDEO_BYTES = 100 * MB;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_LINKS_PER_MESSAGE = 5;

export const ACCEPT_ATTRIBUTE = Object.keys(RULES).map(extension => `.${extension}`).join(',')
  + ',image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/quicktime,video/webm,application/pdf,text/plain,text/markdown,text/csv,application/json,application/zip';

export function fileExtension(name: string): string {
  const lower = String(name || '').toLowerCase().trim();
  if (lower.endsWith('.env.example')) return 'env.example';
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot + 1) : '';
}

export type AttachmentClassification = { ok: true; kind: AttachmentKind; mime: string; label: string; maxBytes: number } | { ok: false; error: string };

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 o';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1).replace('.', ',')} Mo`;
}

/**
 * The type and the limit for one file, or the sentence explaining the refusal.
 */
export function classifyAttachment(name: string, size: number, reportedMime = ''): AttachmentClassification {
  const extension = fileExtension(name);
  const rule = RULES[extension];
  if (!rule) {
    return { ok: false, error: `« ${name} » n’est pas pris en charge. Formats acceptés : images (PNG, JPG, WEBP, GIF, SVG), vidéos (MP4, MOV, WEBM), PDF, DOCX, TXT, MD, CSV, XLSX, JSON, code source et ZIP.` };
  }
  // A declared type that contradicts the extension (an .exe renamed .png is still refused server-side by its bytes).
  const mime = String(reportedMime || '').toLowerCase();
  if (mime && rule.kind === 'image' && !mime.startsWith('image/') && mime !== 'application/octet-stream') {
    return { ok: false, error: `« ${name} » ne semble pas être une image.` };
  }
  const maxBytes = rule.kind === 'video' ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: `« ${name} » est vide.` };
  if (size > maxBytes) {
    const what = rule.kind === 'video' ? 'une vidéo' : rule.kind === 'image' ? 'une image' : 'un fichier';
    return { ok: false, error: `« ${name} » pèse ${formatBytes(size)} : la limite est de ${formatBytes(maxBytes)} pour ${what}.` };
  }
  return { ok: true, kind: rule.kind, mime: rule.mime, label: rule.label, maxBytes };
}

/* ------------------------------------------------------------------------ */
/* Links                                                                     */
/* ------------------------------------------------------------------------ */

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`«»]+/gi;
const BARE_DOMAIN_PATTERN = /(?:^|[\s(])((?:www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>"'`«»]*)?)/gi;

/** The web addresses written in a message, cleaned of trailing punctuation, in order, without duplicates. */
export function extractUrls(text: string, limit = MAX_LINKS_PER_MESSAGE): string[] {
  const found: string[] = [];
  const push = (raw: string) => {
    const cleaned = raw.replace(/[),.;:!?\]}>]+$/g, '');
    try {
      const url = new URL(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return;
      const normalized = url.toString();
      if (!found.includes(normalized)) found.push(normalized);
    } catch { /* not a URL */ }
  };
  for (const match of String(text || '').matchAll(URL_PATTERN)) push(match[0]);
  for (const match of String(text || '').matchAll(BARE_DOMAIN_PATTERN)) push(match[1]);
  return found.slice(0, limit);
}

/** Whether the message asks to look beyond the linked page. */
export function asksToExploreSite(text: string): boolean {
  return /\b(explore|explorer|parcour[se]|toutes les pages|pages internes|autres pages|tout le site|site (entier|complet)|crawl|whole site|all pages|other pages|internal pages)\b/i.test(String(text || ''));
}

/** Whether the message points back at something sent earlier in the session. */
export function refersToEarlierAttachment(text: string): boolean {
  return /(tout à l[’']heure|précédent|précédente|plus haut|déjà envoy|que je t[’']ai (envoy|donn|montr)|l[’']image d[’']avant|la capture|la maquette|le logo|la vidéo|le pdf|le document|le fichier|la charte|earlier|previous|above|the (image|screenshot|mockup|logo|video|pdf|document|file) (i|we) (sent|shared))/i.test(String(text || ''));
}
