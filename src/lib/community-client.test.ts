import { describe, expect, it } from 'vitest';
import { communityHash, parseCommunityHash } from './community-client';

const ID = '123e4567-e89b-12d3-a456-426614174000';
describe('community hash routes', () => {
  it('reads every tab and the detail page', () => {
    expect(parseCommunityHash('#community')).toEqual({ tab: 'discover', listingId: null });
    expect(parseCommunityHash('#community/trending')).toEqual({ tab: 'trending', listingId: null });
    expect(parseCommunityHash('#community/mine')).toEqual({ tab: 'mine', listingId: null });
    expect(parseCommunityHash(`#community/app/${ID}`)).toEqual({ tab: 'discover', listingId: ID });
  });
  it('ignores anything else, including injected ids', () => {
    expect(parseCommunityHash('#suggestions')).toBeNull();
    expect(parseCommunityHash('#community/app/<script>')).toBeNull();
    expect(parseCommunityHash('#community/other')).toBeNull();
  });
  it('builds the same hashes it reads', () => {
    for (const hash of ['#community', '#community/recent', '#community/templates', `#community/app/${ID}`]) {
      const route = parseCommunityHash(hash)!;
      expect(communityHash(route)).toBe(hash);
    }
  });
});
