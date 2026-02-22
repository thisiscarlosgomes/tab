import { PrivyClient } from "@privy-io/node";

let cachedPrivyClient: PrivyClient | null = null;

export function getPrivyServerClient(): PrivyClient {
  if (cachedPrivyClient) return cachedPrivyClient;

  const appId =
    process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("Missing PRIVY_APP_ID/NEXT_PUBLIC_PRIVY_APP_ID or PRIVY_APP_SECRET");
  }

  cachedPrivyClient = new PrivyClient({
    appId,
    appSecret,
    ...(process.env.PRIVY_API_URL ? { apiUrl: process.env.PRIVY_API_URL } : {}),
  });

  return cachedPrivyClient;
}

export function getBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const [scheme, value] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}

