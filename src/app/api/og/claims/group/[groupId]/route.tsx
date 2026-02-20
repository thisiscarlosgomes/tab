// /api/og/claims/group/[groupId]/route.tsx

import { ImageResponse } from "@vercel/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { pathname, origin } = new URL(req.url);
  const groupId = pathname.split("/").pop()?.toLowerCase();

  if (!groupId) return new Response("Missing groupId", { status: 400 });

  const res = await fetch(`${origin}/api/drop/group/${groupId}`, {
    cache: "no-store",
  });

  if (!res.ok) return new Response("Group not found", { status: 404 });

  const { drops } = await res.json();

  if (!Array.isArray(drops) || drops.length === 0) {
    return new Response("No drops in group", { status: 404 });
  }

  const totalAmount = drops
    .reduce((sum, drop) => {
      const amt = parseFloat(drop.amount);
      return isNaN(amt) ? sum : sum + amt;
    }, 0)
    .toFixed(2);

  const creator = drops[0]?.creator || {};
  const splash = creator.pfp || `${origin}/app.png`;

  const tokenRaw = drops[0]?.token;
  const token =
    typeof tokenRaw === "string" && tokenRaw.trim() !== ""
      ? tokenRaw.trim()
      : "ETH";

  const totalDrops = drops.length;
  const claimedCount = drops.filter((d) => d.claimed).length;
  const remainingCount = totalDrops - claimedCount;

  const title = creator.name
    ? `@${creator.name} created a cash link`
    : "You just got";

  const claimText =
    remainingCount > 0
      ? `${remainingCount} of ${totalDrops} left to claim`
      : `All ${totalDrops} claimed`;

  const bg = `${origin}/ogbg.png`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "60px",
          fontFamily: "Inter, sans-serif",
          backgroundImage: `url(${bg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <img
          src={splash}
          alt="creator"
          width={180}
          height={180}
          style={{
            borderRadius: "50%",
            objectFit: "cover",
            border: "6px solid #fff",
            backgroundColor: "#000",
            marginBottom: "20px",
          }}
        />

        <div
          style={{
            fontSize: 54,
            fontWeight: 600,
            color: "white",
            marginBottom: 10,
            textShadow: "0 4px 10px rgba(0,0,0,0.4)",
          }}
        >
          {title}
        </div>

        <div
          style={{
            fontSize: 48,
            fontWeight: 700,
            color: "#16FF99",
            marginBottom: 12,
            textShadow: "0 3px 8px rgba(0,0,0,0.4)",
          }}
        >
          {`${totalAmount} ${token}`}
        </div>

        <div
          style={{
            fontSize: 32,
            fontWeight: 500,
            color: "#D0D3DA",
            textShadow: "0 2px 6px rgba(0,0,0,0.3)",
          }}
        >
          {claimText}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "max-age=1",
      },
    }
  );
}
