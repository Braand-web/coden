import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * A conversation reopened on an answer that died (a deploy, a dropped connection) offers « Réessayer » — on that last
 * answer only, asking the same thing again with the same files, without adding a second copy of the request.
 */
describe('retry on a restored conversation', () => {
  const source = readFileSync('src/builder-live.ts', 'utf8');
  const restore = source.slice(source.indexOf('function restoreMessages'), source.indexOf('function restoreStreamPartsFromPayloadEvents'));

  it('is offered on the last answer only, and only when it failed', () => {
    expect(restore).toMatch(/index === all\.length - 1 && storedStream\?\.status === 'failed' && lastAsked/);
    expect(restore).toMatch(/addInlineAction\(card, 'Réessayer'/);
  });

  it('asks the same thing again with the same attachments, without a second user bubble', () => {
    expect(restore).toMatch(/attachmentExtra\(asked\.attachmentIds, \[\]\)/);
    expect(restore).toMatch(/__codenRetry: true/);
    expect(source).toMatch(/if \(!isRecoveryRetry && !attach\) appendMessage\('user'/);
  });
});
