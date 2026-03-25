import { NextRequest, NextResponse } from "next/server";

type CreateOnrampBody = {
  address?: string;
  sourceAmount?: string;
  sourceCurrency?: string;
  destinationCurrency?: string;
  destinationNetwork?: string;
};

function isHexAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

async function createOnrampSession(
  secretKey: string,
  params: URLSearchParams
) {
  const response = await fetch("https://api.stripe.com/v1/crypto/onramp_sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    cache: "no-store",
  });

  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { raw };
  }
  return { ok: response.ok, status: response.status, payload };
}

export async function POST(req: NextRequest) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json(
      { error: "Stripe is not configured. Missing STRIPE_SECRET_KEY." },
      { status: 500 }
    );
  }

  let body: CreateOnrampBody;
  try {
    body = (await req.json()) as CreateOnrampBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const address = (body.address ?? "").trim();
  const sourceAmount = String(body.sourceAmount ?? "").trim();
  const sourceCurrency = (body.sourceCurrency ?? "usd").trim().toLowerCase();
  const destinationCurrency = (body.destinationCurrency ?? "usdc").trim().toLowerCase();
  const destinationNetwork = (body.destinationNetwork ?? "base").trim().toLowerCase();

  if (!isHexAddress(address)) {
    return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400 });
  }

  const amountNumber = Number(sourceAmount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return NextResponse.json({ error: "A valid source amount is required." }, { status: 400 });
  }

  const params = new URLSearchParams();
  params.set("source_currency", sourceCurrency);
  params.set("source_amount", sourceAmount);
  params.set("destination_network", destinationNetwork);
  params.set("destination_currency", destinationCurrency);
  params.set("wallet_addresses[ethereum]", address);

  const firstAttempt = await createOnrampSession(secretKey, params);
  if (firstAttempt.ok) {
    const result = firstAttempt.payload as {
      id?: string;
      client_secret?: string;
      status?: string;
    };
    return NextResponse.json(
      {
        id: result?.id ?? null,
        clientSecret: result?.client_secret ?? null,
        status: result?.status ?? null,
      },
      { status: 200 }
    );
  }

  // Fallback without wallet prefill in case Stripe rejects network-specific wallet fields.
  const fallbackParams = new URLSearchParams();
  fallbackParams.set("source_currency", sourceCurrency);
  fallbackParams.set("source_amount", sourceAmount);
  fallbackParams.set("destination_network", destinationNetwork);
  fallbackParams.set("destination_currency", destinationCurrency);
  const fallbackAttempt = await createOnrampSession(secretKey, fallbackParams);

  if (!fallbackAttempt.ok) {
    const errorMessage =
      (fallbackAttempt.payload as { error?: { message?: string } })?.error?.message ??
      "Stripe could not create an onramp session.";
    return NextResponse.json({ error: errorMessage }, { status: fallbackAttempt.status });
  }

  const fallbackResult = fallbackAttempt.payload as {
    id?: string;
    client_secret?: string;
    status?: string;
  };
  return NextResponse.json(
    {
      id: fallbackResult?.id ?? null,
      clientSecret: fallbackResult?.client_secret ?? null,
      status: fallbackResult?.status ?? null,
    },
    { status: 200 }
  );
}
