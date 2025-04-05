export const PROXY_API_URL = process.env.PROXY_API_URL ?? "https://proxy.terminal.co/v1";

export const fetchFarcasterUsersByAddresses = (addresses: string) =>
  fetch(`${PROXY_API_URL}/neynar/user/bulk-by-address?addresses=${addresses}`, { cache: "no-store" }).then((res) =>
    res.json()
  );

  