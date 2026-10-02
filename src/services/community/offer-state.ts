const RECORDED_OFFER_STATES = new Set(['later', 'declined', 'accepted']);
const RECORDED_OFFER_EVENTS = new Set(['offer_later', 'offer_declined']);

/** The publication prompt is one-time: every saved answer suppresses another prompt. */
export function communityOfferWasAnswered(input: {
  offerState?: string | null;
  optedIn?: boolean;
  journalEvents?: readonly string[];
}): boolean {
  return Boolean(
    input.optedIn ||
    (input.offerState && RECORDED_OFFER_STATES.has(input.offerState)) ||
    input.journalEvents?.some(event => RECORDED_OFFER_EVENTS.has(event)),
  );
}
