/**
 * Assembles a template app: Coden's own starter files, then the app's files on top.
 *
 *   node --experimental-strip-types scripts/community/assemble-template.ts <slug> <outDir>
 *
 * The same assembly is used to test an app (install, typecheck, build, browser) and to give it to a person who picks the
 * template, so what is tested is exactly what they get.
 */
import fs from 'node:fs';
import path from 'node:path';

export { assembleTemplate, templateOverlay, type TemplateFile } from '../../src/services/community/template-apps.ts';
import { assembleTemplate } from '../../src/services/community/template-apps.ts';

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const [slug, out] = process.argv.slice(2);
  if (!slug || !out) throw new Error('usage: assemble-template.ts <slug> <outDir>');
  for (const file of assembleTemplate(slug)) {
    const target = path.join(out, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content);
  }
  console.log(`assembled ${slug} into ${out}`);
}
