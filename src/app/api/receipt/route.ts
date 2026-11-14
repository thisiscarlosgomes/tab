import { NextRequest, NextResponse } from "next/server";
import { parseReceipt } from "@/lib/receipt";
import { requireTrustedRequest } from "@/lib/security";

export const runtime = "nodejs"; // ✅ REQUIRED
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "receipt",
    limit: 30,
    windowMs: 60_000,
  });
  if (denied) return denied;

  try {
    const { imageBase64 } = await req.json();

    if (!imageBase64) {
      return NextResponse.json(
        { error: "Missing imageBase64" },
        { status: 400 },
      );
    }

    if (typeof imageBase64 !== "string" || imageBase64.length > 10_000_000) {
      return NextResponse.json(
        { error: "Invalid or oversized image payload" },
        { status: 400 },
      );
    }

    return NextResponse.json(await parseReceipt(imageBase64));
  } catch (err: unknown) {
    console.error("Receipt parse error:", err);
    return NextResponse.json(
      { error: "Failed to parse receipt" },
      { status: 500 },
    );
  }
}
