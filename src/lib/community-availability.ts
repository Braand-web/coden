export type CommunityAvailabilityInput = {
  data?: { enabled?: boolean } | null;
  isLoading: boolean;
};

export type CommunityAvailability = 'available' | 'disabled' | 'loading' | 'error';

/** Only a successful, explicit disabled value hides the Community entry point. */
export function communityAvailability(input: CommunityAvailabilityInput): CommunityAvailability {
  if (input.data?.enabled === true) return 'available';
  if (input.data?.enabled === false) return 'disabled';
  if (input.isLoading) return 'loading';
  return 'error';
}

export function shouldShowCommunityLink(input: CommunityAvailabilityInput): boolean {
  return communityAvailability(input) !== 'disabled';
}
