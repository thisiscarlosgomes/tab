import { ImageResponse } from "@vercel/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { pathname, origin } = new URL(req.url);
  const roomId = pathname.split("/").pop();

  if (!roomId) return new Response("Missing roomId", { status: 400 });

  const res = await fetch(`${origin}/api/game/${roomId}`, {
    cache: "no-store",
  });

  if (!res.ok) return new Response("Spin not found", { status: 404 });

  const room = await res.json();
  const roomName = `${room.name} Spin` || "Spin the tab";

  const splash = `${origin}/app.png`;
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
            fontSize: 60,
            fontWeight: 600,
            color: "white",
            textShadow: "0 4px 10px rgba(0,0,0,0.4)",
          }}
        >
          {roomName}
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
