import { ImageResponse } from "@vercel/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { pathname, origin } = new URL(req.url);
  const splitId = pathname.split("/").pop();

  if (!splitId) return new Response("Missing splitId", { status: 400 });

  const res = await fetch(`${origin}/api/split/${splitId}`, {
    cache: "no-store",
  });

  if (!res.ok) return new Response("Bill not found", { status: 404 });

  const getTokenPrefix = (token?: string) => {
    switch (token) {
      case "ETH":
      case "WETH":
        return "Ξ";
      case "EURC":
        return "€";
      case "USDC":
      case "TAB":
      default:
        return "$";
    }
  };

  const formatAmount = (amount: number, token?: string) => {
    if (token === "USDC" || token === "EURC") {
      return amount.toFixed(amount < 1 ? 3 : 2);
    }

    if (token === "ETH" || token === "WETH") {
      if (amount >= 1) return amount.toFixed(2);
      if (amount >= 0.01) return amount.toFixed(4);
      return amount.toPrecision(3);
    }
  };

  const bill = await res.json();

  const perPersonAmount =
    typeof bill?.totalAmount === "number" &&
    typeof bill?.numPeople === "number" &&
    bill.numPeople > 0
      ? bill.totalAmount / bill.numPeople
      : (bill?.totalAmount ?? 0);

  const prefix = getTokenPrefix(bill?.token);
  const amountFormatted = formatAmount(perPersonAmount, bill?.token);

  const title = `${prefix}${amountFormatted} Split`;

  const splash = `${origin}/newnewnewapp.png`;
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
          alt="logo"
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
            fontSize: 64,
            fontWeight: 600,
            color: "white",
            textShadow: "0 4px 10px rgba(0,0,0,0.4)",
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </div>

        <div
          style={{
            marginTop: 8,
            fontSize: 46,
            color: "#D0D3DA",
            textShadow: "0 2px 6px rgba(0,0,0,0.4)",
          }}
        >
          per person
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
