// Wire fields used by the existing game/split endpoints. These are not dinner-room identities.
export type LegacySocialParticipant = {
  address?: string | null;
  fid?: number | string | null;
  provider?: string | null;
  name?: string | null;
  username?: string | null;
  pfp?: string | null;
  pfp_url?: string | null;
  twitter_subject?: string | null;
  userKey?: string | null;
  amount?: number;
  token?: string;
  txHash?: string;
  payoutAddressSource?: string;
  farcasterVerifiedAddress?: string | null;
};
