import { z } from "zod";
import { actor, setTestTime } from "../../../../state";
export async function POST(request: Request) {
  await actor(request);
  const input = z
    .object({ now: z.string().datetime().nullable() })
    .strict()
    .parse(await request.json());
  setTestTime(input.now);
  return Response.json({ ok: true });
}
