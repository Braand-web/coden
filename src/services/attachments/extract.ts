/**
 * What a file says, read on the server.
 *
 * Every attachment is turned into what a model can use: text for documents
 * (PDF, Word, Excel, CSV, code), a tree and the readable files for a ZIP, a
 * normalised image and its palette for pictures, frames every two seconds and
 * the soundtrack for videos. Nothing here trusts the browser: the bytes are
 * checked against the declared type, archives are bounded before they are
 * inflated, and every tool runs with a time limit.
 *
 * Model calls (OCR of a scanned PDF, the description of an image, the
 * transcription of a soundtrack) are injected by the caller, so this module
 * stays testable without a provider.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import type { AttachmentKind } from '../../lib/attachment-policy.ts';
import { fileExtension } from '../../lib/attachment-policy.ts';

export type DerivedFile = { role: 'vision' | 'frame' | 'audio'; name: string; mime: string; data: Uint8Array; at?: number };

export type ExtractionResult = {
  /** One line for lists and the model's session manifest. */
  summary: string;
  /** The readable content, already bounded. */
  text: string;
  meta: Record<string, unknown>;
  derived: DerivedFile[];
};

export type ExtractionDeps = {
  /** Reads a scanned PDF (no text layer) and returns its text. */
  ocrPdf?: (pdf: Uint8Array, name: string) => Promise<string>;
  /** Describes an image for a model that cannot see it. */
  describeImage?: (image: { data: Uint8Array; mime: string }, name: string) => Promise<string>;
  /** Transcribes a soundtrack (mp3). */
  transcribe?: (audio: Uint8Array, name: string) => Promise<string>;
  /** ffmpeg binary; defaults to ffmpeg-static, then the PATH. */
  ffmpegPath?: string;
};

export const MAX_TEXT_CHARS = 60_000;
const MAX_PDF_PAGES = 80;
const MAX_ZIP_ENTRIES = 4_000;
const MAX_ZIP_INFLATED_BYTES = 200 * 1024 * 1024;
const MAX_ZIP_READ_BYTES = 1_500_000;
const MAX_ZIP_FILE_BYTES = 200_000;
const MAX_FRAMES = 40;

/* ------------------------------------------------------------------------ */
/* Bytes                                                                     */
/* ------------------------------------------------------------------------ */

const startsWith = (data: Uint8Array, bytes: number[], offset = 0) => bytes.every((byte, index) => data[offset + index] === byte);
const ascii = (data: Uint8Array, from: number, to: number) => String.fromCharCode(...data.subarray(from, to));

function looksLikeText(data: Uint8Array): boolean {
  const sample = data.subarray(0, Math.min(data.length, 8_192));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / Math.max(1, sample.length) < 0.02;
}

/** Whether the content is what its extension claims. An executable renamed .png is refused here. */
export function contentMatchesKind(data: Uint8Array, name: string, kind: AttachmentKind): boolean {
  const extension = fileExtension(name);
  switch (extension) {
    case 'png': return startsWith(data, [0x89, 0x50, 0x4e, 0x47]);
    case 'jpg': case 'jpeg': return startsWith(data, [0xff, 0xd8, 0xff]);
    case 'gif': return ascii(data, 0, 4) === 'GIF8';
    case 'webp': return ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 12) === 'WEBP';
    case 'svg': return looksLikeText(data) && /<svg[\s>]/i.test(new TextDecoder().decode(data.subarray(0, 4_096)));
    case 'pdf': return ascii(data, 0, 5) === '%PDF-';
    case 'docx': case 'xlsx': case 'zip': return startsWith(data, [0x50, 0x4b, 0x03, 0x04]) || startsWith(data, [0x50, 0x4b, 0x05, 0x06]);
    case 'mp4': case 'mov': return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(ascii(data, 4, 8));
    case 'webm': return startsWith(data, [0x1a, 0x45, 0xdf, 0xa3]);
    default: return kind === 'text' || kind === 'code' || kind === 'spreadsheet' ? looksLikeText(data) : false;
  }
}

/* ------------------------------------------------------------------------ */
/* Text helpers                                                              */
/* ------------------------------------------------------------------------ */

export function clip(text: string, limit = MAX_TEXT_CHARS): string {
  const clean = String(text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}\n\n[… contenu tronqué : ${clean.length - limit} caractères de plus]` : clean;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? '';
  });
}

const decodeUtf8 = (data: Uint8Array) => new TextDecoder('utf-8', { fatal: false }).decode(data).replace(/^﻿/, '');

/* ------------------------------------------------------------------------ */
/* Documents                                                                 */
/* ------------------------------------------------------------------------ */

export async function extractPdfText(data: Uint8Array): Promise<{ text: string; pages: number; pagesRead: number }> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 });
  const document = await task.promise;
  try {
    const pages = Number(document.numPages) || 0;
    const pagesRead = Math.min(pages, MAX_PDF_PAGES);
    const chunks: string[] = [];
    for (let index = 1; index <= pagesRead; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      let line = '';
      const lines: string[] = [];
      for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
        line += item.str || '';
        if (item.hasEOL) { lines.push(line); line = ''; }
      }
      if (line) lines.push(line);
      chunks.push(`--- Page ${index} ---\n${lines.join('\n').trim()}`);
      page.cleanup?.();
    }
    return { text: chunks.join('\n\n'), pages, pagesRead };
  } finally {
    await document.destroy?.();
  }
}

/** Inflates only the entries `wanted` selects, after checking the archive's declared sizes. */
function readZipEntries(data: Uint8Array, wanted: (name: string, size: number) => boolean) {
  const listing: Array<{ name: string; size: number }> = [];
  let declared = 0;
  const files = unzipSync(data, {
    filter: file => {
      listing.push({ name: file.name, size: file.originalSize });
      declared += file.originalSize;
      if (listing.length > MAX_ZIP_ENTRIES) throw new Error(`L’archive contient plus de ${MAX_ZIP_ENTRIES} fichiers.`);
      if (declared > MAX_ZIP_INFLATED_BYTES) throw new Error('L’archive décompressée dépasse 200 Mo.');
      return wanted(file.name, file.originalSize);
    },
  });
  return { files, listing };
}

export function extractDocxText(data: Uint8Array): string {
  const { files } = readZipEntries(data, name => /^word\/(document|footnotes|endnotes)\.xml$/.test(name));
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('Ce fichier Word ne contient pas de document lisible.');
  const body = decodeUtf8(xml)
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:pStyle w:val="(Heading|Titre)(\d)"\/>/gi, (_, _style, level) => `\u0000H${level}\u0000`)
    .replace(/<[^>]+>/g, '');
  return decodeXml(body)
    .replace(/\u0000H(\d)\u0000/g, (_, level) => `${'#'.repeat(Math.min(6, Number(level) || 1))} `)
    .split('\n').map(line => line.trimEnd()).join('\n');
}

function columnIndex(reference: string): number {
  const letters = reference.replace(/[^A-Z]/gi, '').toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return Math.max(0, index - 1);
}

const csvCell = (value: string) => (/[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export function extractXlsxText(data: Uint8Array, maxRows = 200, maxColumns = 40): { text: string; sheets: Array<{ name: string; rows: number }> } {
  const { files } = readZipEntries(data, name => name === 'xl/sharedStrings.xml' || name === 'xl/workbook.xml' || name === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  const shared: string[] = [];
  const sharedXml = files['xl/sharedStrings.xml'] ? decodeUtf8(files['xl/sharedStrings.xml']) : '';
  for (const item of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(decodeXml([...item[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(match => match[1]).join('')));
  }
  const workbook = files['xl/workbook.xml'] ? decodeUtf8(files['xl/workbook.xml']) : '';
  const rels = files['xl/_rels/workbook.xml.rels'] ? decodeUtf8(files['xl/_rels/workbook.xml.rels']) : '';
  const targets = new Map([...rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(match => [match[1], match[2].replace(/^\/?xl\//, '')]));
  const sheets = [...workbook.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((match, index) => ({
    name: decodeXml(match[1]),
    path: `xl/${targets.get(match[2]) || `worksheets/sheet${index + 1}.xml`}`,
  }));
  if (!sheets.length) Object.keys(files).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort().forEach((path, index) => sheets.push({ name: `Feuille ${index + 1}`, path }));

  const blocks: string[] = [];
  const summary: Array<{ name: string; rows: number }> = [];
  for (const sheet of sheets) {
    const xml = files[sheet.path] ? decodeUtf8(files[sheet.path]) : '';
    const rows: string[][] = [];
    let total = 0;
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      total += 1;
      if (rows.length >= maxRows) continue;
      const cells: string[] = [];
      for (const cell of row[1].matchAll(/<c([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attributes = cell[1];
        const inner = cell[2] || '';
        const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1] || '';
        const type = /t="([^"]+)"/.exec(attributes)?.[1] || '';
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = '';
        if (type === 's' && raw !== undefined) value = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = decodeXml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(match => match[1]).join(''));
        else if (raw !== undefined) value = decodeXml(raw);
        const column = reference ? columnIndex(reference) : cells.length;
        if (column < maxColumns) cells[column] = value;
      }
      rows.push(Array.from(cells, value => value ?? ''));
    }
    summary.push({ name: sheet.name, rows: total });
    blocks.push(`--- Feuille « ${sheet.name} » (${total} lignes${total > maxRows ? `, ${maxRows} premières montrées` : ''}) ---\n${rows.map(row => row.map(csvCell).join(',')).join('\n')}`);
  }
  return { text: blocks.join('\n\n'), sheets: summary };
}

export function describeCsv(text: string, maxRows = 200): { text: string; rows: number; columns: string[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim());
  const separator = (lines[0]?.match(/;/g)?.length || 0) > (lines[0]?.match(/,/g)?.length || 0) ? ';' : ',';
  const columns = (lines[0] || '').split(separator).map(value => value.replace(/^"|"$/g, '').trim()).filter(Boolean);
  const shown = lines.slice(0, maxRows + 1).join('\n');
  return { text: lines.length > maxRows + 1 ? `${shown}\n[… ${lines.length - maxRows - 1} lignes de plus]` : shown, rows: Math.max(0, lines.length - 1), columns };
}

/* ------------------------------------------------------------------------ */
/* Archives                                                                  */
/* ------------------------------------------------------------------------ */

const TEXT_IN_ZIP = /\.(md|txt|json|js|jsx|mjs|cjs|ts|tsx|html?|css|scss|vue|svelte|astro|py|rb|php|java|kt|swift|go|rs|c|h|cpp|cs|dart|sql|sh|ya?ml|toml|xml|graphql|prisma|env\.example|csv)$/i;
const SKIPPED_IN_ZIP = /(^|\/)(node_modules|\.git|dist|build|\.next|\.nuxt|vendor|__pycache__|\.venv|coverage)\//;
const IMPORTANT_IN_ZIP = /(^|\/)(package\.json|readme(\.md)?|index\.html|tsconfig\.json|vite\.config\.\w+|next\.config\.\w+|tailwind\.config\.\w+|app\.\w+|main\.\w+)$/i;

function renderTree(paths: string[], limit = 400): string {
  // Archives often omit their folder entries: every parent is listed anyway.
  const all = new Set(paths);
  for (const path of paths) {
    const parts = path.replace(/\/$/, '').split('/');
    for (let depth = 1; depth < parts.length; depth += 1) all.add(`${parts.slice(0, depth).join('/')}/`);
  }
  const sorted = [...all].sort();
  const lines = sorted.slice(0, limit).map(path => {
    const parts = path.replace(/\/$/, '').split('/');
    return `${'  '.repeat(parts.length - 1)}${parts[parts.length - 1]}${path.endsWith('/') ? '/' : ''}`;
  });
  if (sorted.length > limit) lines.push(`… ${sorted.length - limit} entrées de plus`);
  return lines.join('\n');
}

export function extractZip(data: Uint8Array): { text: string; entries: number; files: string[] } {
  let budget = MAX_ZIP_READ_BYTES;
  const { files, listing } = readZipEntries(data, (name, size) => {
    if (name.endsWith('/') || SKIPPED_IN_ZIP.test(name) || !TEXT_IN_ZIP.test(name) || size > MAX_ZIP_FILE_BYTES) return false;
    if (size > budget) return false;
    budget -= size;
    return true;
  });
  const paths = listing.map(entry => entry.name).filter(name => !name.startsWith('__MACOSX/'));
  const visible = paths.filter(name => !SKIPPED_IN_ZIP.test(name));
  const readable = Object.keys(files)
    .filter(name => !name.startsWith('__MACOSX/'))
    .sort((a, b) => Number(IMPORTANT_IN_ZIP.test(b)) - Number(IMPORTANT_IN_ZIP.test(a)) || a.split('/').length - b.split('/').length || a.localeCompare(b));
  const contents = readable.map(name => `--- ${name} ---\n${decodeUtf8(files[name])}`).join('\n\n');
  const hidden = paths.length - visible.length;
  return {
    text: `Arborescence (${paths.length} entrées${hidden ? `, dont ${hidden} dans node_modules/.git/dist non listées` : ''}) :\n${renderTree(visible)}\n\nFichiers lus :\n${contents}`,
    entries: paths.length,
    files: readable,
  };
}

/* ------------------------------------------------------------------------ */
/* Images                                                                    */
/* ------------------------------------------------------------------------ */

const toHex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');

/** The few colours that make a picture, most present first: a logo's brand colours, a mockup's palette. */
export function dominantColors(pixels: Uint8Array, channels: number, count = 6): string[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let index = 0; index + channels - 1 < pixels.length; index += channels) {
    if (channels === 4 && pixels[index + 3] < 128) continue;
    const r = pixels[index]; const g = pixels[index + 1]; const b = pixels[index + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.n += 1;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n).map(bucket => ({ r: bucket.r / bucket.n, g: bucket.g / bucket.n, b: bucket.b / bucket.n }));
  const picked: Array<{ r: number; g: number; b: number }> = [];
  for (const color of ranked) {
    if (picked.every(other => Math.abs(other.r - color.r) + Math.abs(other.g - color.g) + Math.abs(other.b - color.b) > 60)) picked.push(color);
    if (picked.length >= count) break;
  }
  return picked.map(color => `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`.toUpperCase());
}

async function loadSharp(): Promise<any> {
  const module: any = await import('sharp');
  return module.default || module;
}

export async function processImage(data: Uint8Array, name: string, deps: ExtractionDeps): Promise<ExtractionResult> {
  const sharp = await loadSharp();
  const isSvg = fileExtension(name) === 'svg';
  const source = sharp(Buffer.from(data), { animated: false, density: isSvg ? 144 : undefined, limitInputPixels: 80_000_000 });
  const metadata = await source.metadata();
  const hasAlpha = Boolean(metadata.hasAlpha) || isSvg;
  const resized = source.clone().rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: !isSvg });
  const vision = hasAlpha
    ? await resized.clone().png({ compressionLevel: 9 }).toBuffer()
    : await resized.clone().jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  const sample = await source.clone().resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const palette = dominantColors(new Uint8Array(sample.data), sample.info.channels);
  const visionMime = hasAlpha ? 'image/png' : 'image/jpeg';

  let description = '';
  if (deps.describeImage) {
    description = await deps.describeImage({ data: new Uint8Array(vision), mime: visionMime }, name).catch(() => '');
  }
  const svgSource = isSvg ? clip(decodeUtf8(data), 8_000) : '';
  const width = Number(metadata.width) || 0;
  const height = Number(metadata.height) || 0;
  const lines = [
    `Image ${width}×${height}${metadata.pages && metadata.pages > 1 ? ` (animée, ${metadata.pages} images ; la première est montrée)` : ''}.`,
    palette.length ? `Couleurs dominantes : ${palette.join(', ')}.` : '',
    description ? `Description : ${description}` : '',
    svgSource ? `Source SVG :\n${svgSource}` : '',
  ].filter(Boolean);
  return {
    summary: description ? description.split(/(?<=[.!?])\s/)[0].slice(0, 200) : `Image ${width}×${height}`,
    text: lines.join('\n'),
    meta: { width, height, palette, animated: Boolean(metadata.pages && metadata.pages > 1), described: Boolean(description) },
    derived: [{ role: 'vision', name: hasAlpha ? 'vision.png' : 'vision.jpg', mime: visionMime, data: new Uint8Array(vision) }],
  };
}

/* ------------------------------------------------------------------------ */
/* Video                                                                     */
/* ------------------------------------------------------------------------ */

async function resolveFfmpeg(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const module: any = await import('ffmpeg-static');
    const path = module.default || module;
    if (typeof path === 'string' && path) return path;
  } catch { /* not installed */ }
  return 'ffmpeg';
}

function run(binary: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise(resolve => {
    execFile(binary, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error: any, stdout, stderr) => {
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), code: error ? (typeof error.code === 'number' ? error.code : 1) : 0 });
    });
  });
}

export function parseDuration(ffmpegOutput: string): number {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(ffmpegOutput);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
}

/** One frame every two seconds (spread out for long videos), and the soundtrack as a small mp3. */
export async function processVideo(data: Uint8Array, name: string, deps: ExtractionDeps): Promise<ExtractionResult> {
  const ffmpeg = await resolveFfmpeg(deps.ffmpegPath);
  const directory = await mkdtemp(join(tmpdir(), 'coden-video-'));
  try {
    const input = join(directory, `input.${fileExtension(name) || 'mp4'}`);
    await writeFile(input, data);
    const probe = await run(ffmpeg, ['-hide_banner', '-i', input], 20_000);
    const duration = parseDuration(probe.stderr);
    const hasAudio = /Stream #\d+:\d+.*Audio:/.test(probe.stderr);
    const resolution = /Stream #\d+:\d+.*Video:.*?(\d{2,5})x(\d{2,5})/.exec(probe.stderr);
    const interval = duration > 0 ? Math.max(2, Math.ceil(duration / MAX_FRAMES)) : 2;
    const frames = await run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-i', input,
      '-vf', `fps=1/${interval},scale='min(1280,iw)':-2`,
      '-frames:v', String(MAX_FRAMES), '-q:v', '4',
      join(directory, 'frame-%03d.jpg'),
    ], 120_000);
    if (frames.code !== 0 && !duration) throw new Error('Cette vidéo n’a pas pu être lue (format ou codec non pris en charge).');
    const frameFiles = (await readdir(directory)).filter(file => file.startsWith('frame-')).sort();
    const derived: DerivedFile[] = [];
    for (const [index, file] of frameFiles.entries()) {
      derived.push({ role: 'frame', name: file, mime: 'image/jpeg', data: new Uint8Array(await readFile(join(directory, file))), at: index * interval });
    }

    let transcript = '';
    if (hasAudio) {
      const audioPath = join(directory, 'audio.mp3');
      const audio = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', '-t', '900', audioPath], 120_000);
      if (audio.code === 0) {
        const audioData = new Uint8Array(await readFile(audioPath));
        derived.push({ role: 'audio', name: 'audio.mp3', mime: 'audio/mpeg', data: audioData });
        if (deps.transcribe) transcript = await deps.transcribe(audioData, name).catch(() => '');
      }
    }

    const minutes = duration ? `${Math.floor(duration / 60)} min ${Math.round(duration % 60)} s` : 'durée inconnue';
    const text = [
      `Vidéo de ${minutes}${resolution ? `, ${resolution[1]}×${resolution[2]}` : ''}. ${derived.filter(file => file.role === 'frame').length} images clés extraites (une toutes les ${interval} s).`,
      hasAudio ? (transcript ? `Transcription de la bande son :\n${clip(transcript, 20_000)}` : 'La bande son n’a pas pu être transcrite.') : 'La vidéo n’a pas de son.',
    ].join('\n');
    return {
      summary: `Vidéo de ${minutes}${transcript ? ', transcrite' : ''}`,
      text,
      meta: { duration, interval, frames: frameFiles.length, hasAudio, transcribed: Boolean(transcript), width: Number(resolution?.[1]) || 0, height: Number(resolution?.[2]) || 0 },
      derived,
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/* ------------------------------------------------------------------------ */
/* Entry point                                                               */
/* ------------------------------------------------------------------------ */

export async function extractAttachment(data: Uint8Array, name: string, kind: AttachmentKind, deps: ExtractionDeps = {}): Promise<ExtractionResult> {
  const extension = fileExtension(name);
  if (kind === 'image') return processImage(data, name, deps);
  if (kind === 'video') return processVideo(data, name, deps);

  if (extension === 'pdf') {
    let parsed = { text: '', pages: 0, pagesRead: 0 };
    try { parsed = await extractPdfText(data); } catch { /* damaged text layer: OCR below */ }
    const words = parsed.text.replace(/--- Page \d+ ---/g, '').split(/\s+/).filter(Boolean).length;
    // A scanned PDF has pages and (almost) no text: read it with OCR.
    let ocr = '';
    if (words < Math.max(20, parsed.pagesRead * 15) && deps.ocrPdf) ocr = await deps.ocrPdf(data, name).catch(() => '');
    const text = ocr ? `Texte reconnu par OCR (PDF scanné) :\n${ocr}` : parsed.text;
    return {
      summary: `PDF de ${parsed.pages || '?'} page${parsed.pages > 1 ? 's' : ''}${ocr ? ', lu par OCR' : ''}`,
      text: clip(text),
      meta: { pages: parsed.pages, pagesRead: parsed.pagesRead, ocr: Boolean(ocr), words },
      derived: [],
    };
  }
  if (extension === 'docx') {
    const text = extractDocxText(data);
    return { summary: `Document Word, ${text.split(/\s+/).filter(Boolean).length} mots`, text: clip(text), meta: {}, derived: [] };
  }
  if (extension === 'xlsx') {
    const { text, sheets } = extractXlsxText(data);
    return { summary: `Classeur Excel, ${sheets.length} feuille${sheets.length > 1 ? 's' : ''} (${sheets.map(sheet => `${sheet.name} : ${sheet.rows} lignes`).join(', ')})`, text: clip(text), meta: { sheets }, derived: [] };
  }
  if (extension === 'zip') {
    const zip = extractZip(data);
    return { summary: `Archive ZIP, ${zip.entries} entrées`, text: clip(zip.text), meta: { entries: zip.entries, files: zip.files.slice(0, 200) }, derived: [] };
  }
  const raw = decodeUtf8(data);
  if (extension === 'csv') {
    const csv = describeCsv(raw);
    return { summary: `Tableau CSV, ${csv.rows} lignes${csv.columns.length ? ` (${csv.columns.slice(0, 6).join(', ')}${csv.columns.length > 6 ? '…' : ''})` : ''}`, text: clip(csv.text), meta: { rows: csv.rows, columns: csv.columns }, derived: [] };
  }
  if (extension === 'json') {
    let pretty = raw;
    try { pretty = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* shown as sent */ }
    return { summary: `JSON, ${raw.length.toLocaleString('fr-FR')} caractères`, text: clip(pretty), meta: {}, derived: [] };
  }
  const lines = raw.split('\n').length;
  return { summary: `${kind === 'code' ? 'Code' : 'Texte'}, ${lines} lignes`, text: clip(raw), meta: { lines }, derived: [] };
}
