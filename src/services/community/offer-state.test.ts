import { describe, expect, it } from 'vitest';
import { communityOfferWasAnswered } from './offer-state';

describe('Community publication offer memory', () => {
  it.each(['later', 'declined', 'accepted'])('treats the saved "%s" choice as answered', offerState => {
    expect(communityOfferWasAnswered({ offerState })).toBe(true);
  });

  it('remembers choices for projects that do not yet have a listing', () => {
    expect(communityOfferWasAnswered({ journalEvents: ['offer_later'] })).toBe(true);
    expect(communityOfferWasAnswered({ journalEvents: ['offer_declined'] })).toBe(true);
  });

  it('does not suppress an offer when no choice has been recorded', () => {
    expect(communityOfferWasAnswered({ offerState: null, optedIn: false, journalEvents: ['published'] })).toBe(false);
  });
});
