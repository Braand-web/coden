import assert from 'node:assert/strict';
import {
  applyImportContextToPrompt,
  buildImportContext,
} from './src/services/import-intelligence.ts';

const figmaNeedsConnection = buildImportContext({
  source: 'figma',
  url: 'https://www.figma.com/design/abc123/Coden-App',
}, { figmaConfigured: false });

assert.equal(figmaNeedsConnection?.source, 'figma');
assert.equal(figmaNeedsConnection?.status, 'needs_connection');
assert.ok(figmaNeedsConnection?.prompt.includes('transform the Figma mockup into a real, responsive, editable web app'));

const githubImport = buildImportContext({
  source: 'github',
  url: 'https://github.com/acme/project',
}, { githubConfigured: true });

assert.equal(githubImport?.source, 'github');
assert.equal(githubImport?.status, 'ready');
assert.ok(githubImport?.prompt.includes('detect framework'));
assert.ok(githubImport?.prompt.includes('Preserve the existing architecture'));

const imageNeedsFile = buildImportContext({ source: 'image' });
assert.equal(imageNeedsFile?.status, 'needs_file');
assert.ok(imageNeedsFile?.message.includes('Ajoute une image'));

const imageImport = buildImportContext({
  source: 'image',
  fileName: 'dashboard.png',
  mimeType: 'image/png',
  hasAttachment: true,
});
assert.equal(imageImport?.status, 'ready');
assert.ok(imageImport?.message.includes('J’ai analysé l’image'));
assert.ok(imageImport?.prompt.includes('recreate the interface'));

const badUrl = buildImportContext({ source: 'url', url: 'not a url with spaces' });
assert.equal(badUrl?.status, 'invalid');

const wrappedPrompt = applyImportContextToPrompt('Build this as a product.', githubImport);
assert.ok(wrappedPrompt.includes('Coden import context'));
assert.ok(wrappedPrompt.includes('Import source: GitHub repository'));
assert.ok(wrappedPrompt.includes('User request:'));

console.log('import intelligence ok');
