import assert from 'node:assert/strict';
import {
  messagePartsFromContent,
  messageTextFromParts,
  normalizeMessageParts,
  redactMessageParts,
} from './src/lib/chat-message-parts.ts';

const fromContent = messagePartsFromContent('Bonjour Coden');
assert.deepEqual(fromContent, [{ type: 'text', text: 'Bonjour Coden' }]);

const mixed = normalizeMessageParts([
  { type: 'text', text: 'Réponse' },
  { type: 'reasoning', text: 'Analyse interne' },
  { type: 'tool-search', state: 'output-available', result: 'OK' },
]);
assert.equal(mixed.length, 3);
assert.equal(messageTextFromParts(mixed), 'Réponse\nAnalyse interne');

const fallback = normalizeMessageParts([], 'Fallback text');
assert.deepEqual(fallback, [{ type: 'text', text: 'Fallback text' }]);

const redacted = redactMessageParts([
  { type: 'text', text: 'secret: sk-test-123' },
  { type: 'dynamic-tool', error: 'token abc' },
], value => value.replace(/sk-test-\d+|abc/g, '[redacted]'));
assert.equal(redacted[0].text, 'secret: [redacted]');
assert.equal(redacted[1].error, 'token [redacted]');

console.log('chat message parts ok');
