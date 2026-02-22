export const PROXY_API_URL = process.env.PROXY_API_URL ?? "https://proxy.terminal.co/v1";

type FarcasterUsersByAddress = Record<string, any>;

export const fetchFarcasterUsersByAddresses = async (
  addresses: string
): Promise<FarcasterUsersByAddress> => {
  if (!addresses) return {};

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await fetch(
      `${PROXY_API_URL}/neynar/user/bulk-by-address?addresses=${encodeURIComponent(addresses)}`,
      {
        cache: "no-store",
        signal: controller.signal,
      }
    );

    if (!res.ok) return {};

    const data = await res.json();
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
};

  
