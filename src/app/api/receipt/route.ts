import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireTrustedRequest } from "@/lib/security";

export const runtime = "nodejs"; // ✅ REQUIRED
export const maxDuration = 60;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

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
        { status: 400 }
      );
    }

    if (typeof imageBase64 !== "string" || imageBase64.length > 10_000_000) {
      return NextResponse.json(
        { error: "Invalid or oversized image payload" },
        { status: 400 }
      );
    }

    // IMPORTANT: must be full data URL
    const imageUrl = imageBase64.startsWith("data:")
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_image",
              image_url: imageUrl,
              detail: "high", // ✅ REQUIRED
            },
            {
              type: "input_text",
              text: `
You are a receipt parser.

Extract:
- merchant
- totalAmount (number)
- currency
- items [{ name, price }]
- confidence (0-1)

Return ONLY valid JSON.
      `,
            },
          ],
        },
      ],
    });

   const outputText = response.output_text;

if (!outputText) {
  return NextResponse.json(
    { error: "No output from OpenAI" },
    { status: 500 }
  );
}

const cleaned = outputText
  .trim()
  .replace(/^```json\s*/i, "")
  .replace(/^```\s*/i, "")
  .replace(/```$/i, "");

let parsed;
try {
  parsed = JSON.parse(cleaned);
} catch (e) {
  console.error("Raw model output:", outputText);
  throw e;
}

return NextResponse.json(parsed);

  } catch (err: unknown) {
    console.error("Receipt parse error:", err);
    return NextResponse.json(
      { error: "Failed to parse receipt" },
      { status: 500 }
    );
  }
}
