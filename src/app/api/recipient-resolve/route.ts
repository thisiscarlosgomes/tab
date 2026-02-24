import { NextRequest } from "next/server";
import { requireTrustedRequest } from "@/lib/security";
import { resolveRecipient } from "@/lib/recipient-resolver";

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

  if (!username && !address) {
    return Response.json(
      { error: "Missing username or address" },
      { status: 400 }
    );
  }

  // Prefer username-based resolution so Tab users route to their Tab wallet.
  const resolved = username
    ? await resolveRecipient({ recipient: username, recipientUsername: username })
    : await resolveRecipient({ recipient: address, recipientAddress: address });

  if (!resolved) {
    return Response.json({ resolved: null });
  }

  return Response.json({ resolved });
}
