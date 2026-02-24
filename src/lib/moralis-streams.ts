type MoralisStreamsAddressPayload = {
  address: string[];
};

function getMoralisStreamsConfig() {
  const apiKey = process.env.MORALIS_API_KEY?.trim();
  const streamId = process.env.MORALIS_STREAM_ID?.trim();
  if (!apiKey || !streamId) return null;
  return {
    apiKey,
    streamId,
    baseUrl: "https://api.moralis-streams.com",
  };
}

export function isMoralisStreamSyncConfigured() {
  return Boolean(getMoralisStreamsConfig());
}

function uniqueAddresses(addresses: string[]) {
  return Array.from(
    new Set(
      addresses
        .map((a) => a.trim().toLowerCase())
        .filter((a) => /^0x[a-f0-9]{40}$/.test(a))
    )
  );
}

async function moralisStreamAddressRequest(
  method: "POST" | "DELETE",
  addresses: string[]
) {
  const config = getMoralisStreamsConfig();
  if (!config) {
    return { ok: false as const, skipped: "not_configured" as const };
  }

  const normalized = uniqueAddresses(addresses);
  if (normalized.length === 0) {
    return { ok: true as const, skipped: "no_addresses" as const };
  }

  const res = await fetch(`${config.baseUrl}/streams/evm/${config.streamId}/address`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": config.apiKey,
    },
    body: JSON.stringify({ address: normalized } satisfies MoralisStreamsAddressPayload),
    cache: "no-store",
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      ok: false as const,
      status: res.status,
      error:
        (body &&
          typeof body === "object" &&
          "message" in body &&
          typeof (body as { message?: unknown }).message === "string" &&
          (body as { message: string }).message) ||
        `Moralis stream address sync failed (${res.status})`,
      body,
    };
  }

  return { ok: true as const, body };
}

export function addAddressesToMoralisStream(addresses: string[]) {
  return moralisStreamAddressRequest("POST", addresses);
}

export function removeAddressesFromMoralisStream(addresses: string[]) {
  return moralisStreamAddressRequest("DELETE", addresses);
}

