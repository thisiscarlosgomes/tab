import { ImageResponse } from "@vercel/og";
import { isAddress } from "viem";
import { normalize } from "viem/ens";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { pathname } = new URL(req.url);
  const slug = pathname.split("/").pop();
  const baseUrl = process.env.PUBLIC_URL?.trim() || req.nextUrl.origin;

  if (!slug) return new Response("Missing slug", { status: 400 });

  let label = "";
  let pfp: string | null = null;
  const client = createPublicClient({ chain: mainnet, transport: http() });

  if (isAddress(slug)) {
    label = `${slug.slice(0, 6)}…${slug.slice(-4)}`;
    try {
      const res = await fetch(
        `${baseUrl}/api/neynar/user/by-address/${slug}`
      );
      const data = await res.json();
      if (data?.username) label = `@${data.username}`;
      if (data?.pfp_url) pfp = data.pfp_url;
    } catch {}
  } else {
    try {
      const res = await fetch(
        `${baseUrl}/api/neynar/user/by-username?username=${slug}`
      );
      const data = await res.json();
      const eth = data?.verified_addresses?.primary?.eth_address;
      if (eth) {
        label = `@${data.username}`;
        if (data?.pfp_url) pfp = data.pfp_url;
      }
    } catch {}

    if (!label) {
      try {
        const ens = await client.getEnsAddress({ name: normalize(slug) });
        if (ens) label = slug;
      } catch {}
    }
  }

  const fallbackPfp = `${baseUrl}/app.png`;

  const bg = `${baseUrl}/ogbg.png`;

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
          src={pfp || fallbackPfp}
          alt="pfp"
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
            fontSize: 60,
            fontWeight: 600,
            color: "white",
            textShadow: "0 4px 10px rgba(0,0,0,0.4)",
          }}
        >
          {label || "Unknown"}
        </div>

        <div
          style={{
            marginTop: 8,
            fontSize: 32,
            color: "#D0D3DA",
            textShadow: "0 2px 6px rgba(0,0,0,0.4)",
          }}
        >
          Pay with tab
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      status: 200,
      headers: {
        "Cache-Control": "max-age=1",
      },
    }
  );
}
