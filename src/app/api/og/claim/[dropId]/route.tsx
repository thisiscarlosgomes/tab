import { ImageResponse } from "@vercel/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { pathname, origin } = new URL(req.url);
  const dropId = pathname.split("/").pop();

  if (!dropId) return new Response("Missing dropId", { status: 400 });

  const res = await fetch(`${origin}/api/drop/${dropId}`, {
    cache: "no-store",
  });

  if (!res.ok) return new Response("Drop not found", { status: 404 });

  const { drop } = await res.json();

  const title = drop?.creator?.name
    ? `@${drop.creator.name} sent you`
    : "You just got";

  const amount = `${drop.amount} ${drop.token}`;
  const splash = drop?.creator?.pfp || `${origin}/newnewnewapp.png`;
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
          alt="splash"
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
            textShadow: "0 3px 8px rgba(0,0,0,0.4)",
          }}
        >
          {amount}
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
