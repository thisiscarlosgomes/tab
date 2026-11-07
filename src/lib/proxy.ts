import { z } from "zod";
export const PROXY_API_URL = process.env.PROXY_API_URL ?? "https://proxy.terminal.co/v1";

const addressProfiles = z.record(z.unknown());
type FarcasterUsersByAddress = z.infer<typeof addressProfiles>;

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

    const data: unknown = await res.json();
    const parsed = addressProfiles.safeParse(data);
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
};

  
