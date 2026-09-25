import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';
import { describe, expect, it, vi } from 'vitest';
import { contentMatchesKind, dominantColors, extractAttachment, extractZip, parseDuration } from './extract';

/** A one-page PDF with a text layer (or none), built by hand with correct offsets. */
function pdf(text: string | null): Uint8Array {
  const stream = text === null ? '' : `BT /F1 18 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return strToU8(body);
}

describe('attachment extraction', () => {
  it('checks the bytes against the extension', () => {
    expect(contentMatchesKind(pdf('x'), 'a.pdf', 'document')).toBe(true);
    expect(contentMatchesKind(new Uint8Array([0x4d, 0x5a, 0x90, 0]), 'a.png', 'image')).toBe(false);
    expect(contentMatchesKind(strToU8('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'a.svg', 'image')).toBe(true);
    expect(contentMatchesKind(new Uint8Array([0x68, 0, 0x69]), 'notes.txt', 'text')).toBe(false);
    expect(contentMatchesKind(strToU8('const a = 1;\n'), 'app.ts', 'code')).toBe(true);
  });

  it('reads the text layer of a PDF', async () => {
    const result = await extractAttachment(pdf('Cahier des charges : boutique de cafe'), 'brief.pdf', 'document');
    expect(result.text).toContain('Cahier des charges : boutique de cafe');
    expect(result.summary).toBe('PDF de 1 page');
    expect(result.meta).toMatchObject({ pages: 1, ocr: false });
  });

  it('sends a scanned PDF (no text layer) to OCR', async () => {
    const ocrPdf = vi.fn(async () => 'Texte reconnu sur la page');
    const result = await extractAttachment(pdf(null), 'scan.pdf', 'document', { ocrPdf });
    expect(ocrPdf).toHaveBeenCalledOnce();
    expect(result.text).toContain('Texte reconnu par OCR');
    expect(result.summary).toContain('lu par OCR');
  });

  it('reads Word, Excel, CSV and JSON', async () => {
    const docx = zipSync({ 'word/document.xml': strToU8('<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Objectifs</w:t></w:r></w:p><w:p><w:r><w:t>Réservation &amp; paiement</w:t></w:r></w:p></w:body></w:document>') });
    expect((await extractAttachment(docx, 'spec.docx', 'document')).text).toBe('# Objectifs\nRéservation & paiement');

    const xlsx = zipSync({
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Menu" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>Plat</t></si><si><t>Prix</t></si><si><t>Attiéké, poisson</t></si></sst>'),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>2500</v></c></row></sheetData></worksheet>'),
    });
    const sheet = await extractAttachment(xlsx, 'menu.xlsx', 'spreadsheet');
    expect(sheet.text).toContain('Plat,Prix\n"Attiéké, poisson",,2500');
    expect(sheet.summary).toContain('Menu : 2 lignes');

    const csv = await extractAttachment(strToU8('nom;prix\ncafé;500\nthé;400\n'), 'prix.csv', 'spreadsheet');
    expect(csv.summary).toBe('Tableau CSV, 2 lignes (nom, prix)');
    const json = await extractAttachment(strToU8('{"a":1}'), 'data.json', 'code');
    expect(json.text).toBe('{\n  "a": 1\n}');
  });

  it('lists a ZIP and reads its source files, never node_modules', () => {
    const zip = zipSync({
      'shop/package.json': strToU8('{"name":"shop"}'),
      'shop/src/App.tsx': strToU8('export default function App() {}'),
      'shop/node_modules/react/index.js': strToU8('module.exports = {}'),
      'shop/public/logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const result = extractZip(zip);
    expect(result.text).toContain('shop/\n  package.json\n  public/\n    logo.png\n  src/\n    App.tsx');
    expect(result.text).toContain('--- shop/package.json ---');
    expect(result.text).not.toContain('module.exports');
    expect(result.files).toEqual(['shop/package.json', 'shop/src/App.tsx']);
  });

  it('refuses an archive that inflates past its limits before inflating it', () => {
    const entries: Record<string, Uint8Array> = {};
    for (let index = 0; index < 4_100; index += 1) entries[`f${index}.txt`] = strToU8('x');
    expect(() => extractZip(zipSync(entries))).toThrow(/plus de 4000 fichiers/);
  });

  it('normalises an image, finds its palette and asks for a description', async () => {
    const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 91, g: 58, b: 41, alpha: 1 } } }).png().toBuffer();
    const describeImage = vi.fn(async () => 'Un logo brun. Style sobre.');
    const result = await extractAttachment(new Uint8Array(png), 'logo.png', 'image', { describeImage });
    expect(result.meta).toMatchObject({ width: 300, height: 200, palette: ['#5B3A29'] });
    expect(result.text).toContain('Couleurs dominantes : #5B3A29.');
    expect(result.summary).toBe('Un logo brun.');
    expect(result.derived[0]).toMatchObject({ role: 'vision', mime: 'image/png' });
  });

  it('keeps the source of an SVG and rasterises it', async () => {
    const svg = strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#0A7CFF"/></svg>');
    const result = await extractAttachment(svg, 'mark.svg', 'image');
    expect(result.text).toContain('Source SVG');
    expect(result.meta.palette).toContain('#0A7CFF');
  });

  it('picks distinct dominant colours', () => {
    const pixels = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 10, 124, 255, 255, 250, 250, 250, 255]);
    expect(dominantColors(pixels, 4, 3)).toEqual(['#FDFDFD', '#0A7CFF']);
  });

  it('reads the duration printed by ffmpeg', () => {
    expect(parseDuration('  Duration: 00:01:07.52, start: 0.000000')).toBeCloseTo(67.52);
    expect(parseDuration('nothing')).toBe(0);
  });

  it('extracts one frame every two seconds and the soundtrack of a video', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'coden-video-test-'));
    try {
      const output = join(directory, 'clip.mp4');
      execFileSync(ffmpegPath as unknown as string, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=6:size=320x180:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', output]);
      const transcribe = vi.fn(async () => 'Bonjour et bienvenue');
      const result = await extractAttachment(new Uint8Array(readFileSync(output)), 'demo.mp4', 'video', { transcribe });
      const frames = result.derived.filter(file => file.role === 'frame');
      expect(frames.length).toBe(3);
      expect(frames.map(frame => frame.at)).toEqual([0, 2, 4]);
      expect(result.derived.some(file => file.role === 'audio')).toBe(true);
      expect(transcribe).toHaveBeenCalledOnce();
      expect(result.text).toContain('une toutes les 2 s');
      expect(result.text).toContain('Bonjour et bienvenue');
      expect(result.meta).toMatchObject({ hasAudio: true, transcribed: true, width: 320, height: 180 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
