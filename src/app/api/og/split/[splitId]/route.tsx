import { ImageResponse } from "@vercel/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { pathname, origin } = new URL(req.url);
  const splitId = pathname.split("/").pop();

  if (!splitId) return new Response("Missing splitId", { status: 400 });

  // Fetch the bill from your internal API
  const res = await fetch(`${origin}/api/split/${splitId}`, {
    cache: "no-store",
  });

  if (!res.ok) return new Response("Bill not found", { status: 404 });

  const bill = await res.json();
  const groupName = `${bill.description} Group Bill` || "Group Bill";

  const splash = `${origin}/splash.png`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: "#201E23",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "60px",
          fontFamily: "Inter, sans-serif",
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
        <div style={{ fontSize: 60, fontWeight: 600, color: "white" }}>
          {groupName}
        </div>
        <div style={{ marginTop: 8, fontSize: 32, color: "#9FA3AF" }}>
          Pay with Tab
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
