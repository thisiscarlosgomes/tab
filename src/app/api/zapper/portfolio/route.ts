import { NextRequest } from "next/server";

const REMOVED = {
  error: "This API has been removed",
  feature: "zapper-portfolio",
};

export async function GET(_req: NextRequest) {
  return Response.json(REMOVED, { status: 410 });
}
