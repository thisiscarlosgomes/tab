import { NextRequest } from "next/server";
import { requireTrustedRequest } from "@/lib/security";
import { getCanonicalUserProfileByAddress } from "@/lib/user-profile";

function normalizeAddress(value: unknown) {
  const v = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(v) ? v : null;
}

export async function GET(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "user-by-address-get",
    limit: 200,
    windowMs: 60_000,
  });
  if (denied) return denied;

  const rawAddress = req.nextUrl.pathname.split("/").pop();
  const address = normalizeAddress(rawAddress);
  if (!address) {
    return Response.json({ error: "Invalid address" }, { status: 400 });
  }

  const profile = await getCanonicalUserProfileByAddress(address);
  if (!profile) return Response.json({ profile: null });

  return Response.json({
    profile: {
      userId: profile.userId,
      fid: profile.fid,
      username: profile.username,
      displayName: profile.displayName,
      pfpUrl: profile.pfpUrl,
      primaryAddress: profile.primaryAddress,
    },
  });
}

