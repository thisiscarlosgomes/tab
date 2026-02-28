export type SocialUser = {
  id: string;
  provider: "farcaster" | "twitter" | "address";
  fid?: number;
  twitter_subject?: string;
  username: string;
  display_name?: string;
  pfp_url?: string;
  verified_addresses?: {
    primary?: {
      eth_address?: string | null;
    };
  };
};

export function getSocialUserKey(user: Pick<SocialUser, "id" | "provider" | "fid" | "twitter_subject" | "username">) {
  return (
    user.id ||
    (user.provider === "farcaster" && typeof user.fid === "number"
      ? `farcaster:${user.fid}`
      : user.provider === "twitter" && user.twitter_subject
        ? `twitter:${user.twitter_subject}`
        : `${user.provider}:${user.username.toLowerCase()}`)
  );
}
