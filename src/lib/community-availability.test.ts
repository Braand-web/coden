import { describe, expect, it } from 'vitest';
import { communityAvailability, shouldShowCommunityLink } from './community-availability';

describe('Community access availability', () => {
  it('keeps the entry point while configuration is loading or unavailable', () => {
    expect(communityAvailability({ isLoading: true })).toBe('loading');
    expect(shouldShowCommunityLink({ isLoading: true })).toBe(true);
    expect(communityAvailability({ isLoading: false })).toBe('error');
    expect(shouldShowCommunityLink({ isLoading: false })).toBe(true);
  });

  it('shows the Community when the server confirms it is enabled', () => {
    const input = { data: { enabled: true }, isLoading: false };
    expect(communityAvailability(input)).toBe('available');
    expect(shouldShowCommunityLink(input)).toBe(true);
  });

  it('hides the entry point only after an explicit disabled response', () => {
    const input = { data: { enabled: false }, isLoading: false };
    expect(communityAvailability(input)).toBe('disabled');
    expect(shouldShowCommunityLink(input)).toBe(false);
  });
});
