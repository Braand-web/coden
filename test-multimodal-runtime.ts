import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildVisionMessageContent } from './src/services/openrouter-service.ts';

const content = buildVisionMessageContent('Inspect this UI.', [
  { url: 'https://example.com/screen.png', detail: 'high' },
  { url: 'file:///private/image.png' },
]);

assert.equal(content[0].type, 'text');
assert.equal(content.length, 2, 'Only safe HTTP/data image inputs should be sent to the provider.');
assert.equal(content[1].type, 'image_url');

const builderSource = readFileSync(new URL('./src/builder-live.ts', import.meta.url), 'utf8');
assert.match(builderSource, /const visionInputs = promptVisionInputs\(\)/);
assert.match(builderSource, /visionInputs\.length \? \{ visionInputs \} : \{\}/);

const promptActionsSource = readFileSync(new URL('./src/prompt-input-actions.ts', import.meta.url), 'utf8');
assert.match(promptActionsSource, /onAttachmentsChange\?\.\(\[\.\.\.attachments\]\)/);

console.log('multimodal runtime tests passed');
