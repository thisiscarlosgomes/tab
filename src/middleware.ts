import { NextRequest, NextResponse } from "next/server";
import { isDinnerPath } from "./lib/dinner/theme";

// Overwrite caller-supplied hints. This controls presentation, never authorization.
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(
    "x-tab-surface",
    isDinnerPath(request.nextUrl.pathname) ? "dinner" : "legacy",
  );
  return NextResponse.next({ request: { headers } });
}
export const config = { matcher: ["/((?!api/|_next/|favicon.ico).*)"] };
