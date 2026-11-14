import { after } from "next/server";
import { replyToMessage, labStatus } from "../../../../live-lab";
import { handleDinner } from "@/lib/dinner/http";
import { dependencies } from "../../../../state";
export const dynamic = "force-dynamic";
async function handler(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  const path = (await context.params).path ?? [];
  const response = await handleDinner(request, path, dependencies);
  if (
    process.env.TAB_LIVE_LAB === "1" &&
    request.method === "POST" &&
    path.length === 3 &&
    path[0] === "rooms" &&
    path[1] === labStatus().roomId &&
    path[2] === "messages" &&
    response.ok
  ) {
    const saved = await response.clone().json();
    after(async () => {
      await replyToMessage(saved.id);
    });
  }
  return response;
}
export {
  handler as GET,
  handler as POST,
  handler as PATCH,
  handler as PUT,
  handler as DELETE,
};
