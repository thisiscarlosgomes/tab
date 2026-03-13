import { NextRequest } from "next/server";
import { requireTrustedRequest } from "@/lib/security";
import { resolveRecipient } from "@/lib/recipient-resolver";
import { getPrivyAuthedUserFromAuthorization } from "@/lib/user-profile";

export async function GET(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "recipient-resolve-get",
    limit: 200,
    windowMs: 60_000,
  });
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const username = searchParams.get("username")?.trim() ?? "";
  const address = searchParams.get("address")?.trim() ?? "";
  const ens = searchParams.get("ens")?.trim() ?? "";
  const providerParam = searchParams.get("provider")?.trim().toLowerCase() ?? "";
  const recipientProvider =
    providerParam === "twitter" || providerParam === "farcaster"
      ? providerParam
      : null;

  if (!username && !address && !ens) {
    return Response.json(
      { error: "Missing username, ens, or address" },
      { status: 400 }
    );
  }

  const authed = await getPrivyAuthedUserFromAuthorization(
    req.headers.get("authorization")
  );
  const actorUserId = authed.ok ? String(authed.user.id ?? "").trim() : null;

  let resolved = null;
  try {
    // Prefer username-based resolution so Tab users route to their Tab wallet.
    resolved = username
      ? await resolveRecipient({
          recipient: username,
          recipientUsername: username,
          recipientProvider,
          actorUserId,
        })
      : ens
        ? await resolveRecipient({
            recipient: ens,
            recipientEns: ens,
            actorUserId,
          })
      : await resolveRecipient({ recipient: address, recipientAddress: address, actorUserId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Recipient resolution failed";
    if (recipientProvider === "twitter") {
      return Response.json(
        { error: "Unable to prepare a wallet for this Twitter user right now." },
        { status: 200 }
      );
    }
    return Response.json({ error: message }, { status: 500 });
  }

  if (!resolved) {
    return Response.json({ resolved: null });
  }

  return Response.json({ resolved });
}
