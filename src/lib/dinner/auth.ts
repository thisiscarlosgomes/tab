import { z } from "zod";
import { getBearerToken, getPrivyServerClient } from "../privy-server";
import { DinnerError } from "./model";
import { VerifiedProfile } from "./mongo-store";

const account = z.object({
  type: z.string(),
  subject: z.string().nullish(),
  username: z.string().nullish(),
  name: z.string().nullish(),
});
const userSchema = z.object({
  id: z.string().min(1),
  twitter: z
    .object({
      subject: z.string().nullish(),
      name: z.string().nullish(),
      username: z.string().nullish(),
    })
    .nullish(),
  linked_accounts: z.array(account).optional(),
  linkedAccounts: z.array(account).optional(),
});
export async function verifyDinnerSession(
  request: Request,
): Promise<VerifiedProfile> {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) throw new DinnerError(401, "Sign in to continue");
  let raw: unknown;
  try {
    const client = getPrivyServerClient();
    try {
      const verified = await client.utils().auth().verifyAccessToken(token);
      raw = await client.users()._get(verified.user_id);
    } catch {
      raw = await client.users().get({ id_token: token });
    }
  } catch {
    throw new DinnerError(401, "Your session expired. Sign in again.");
  }
  const user = userSchema.safeParse(raw);
  if (!user.success)
    throw new DinnerError(401, "Could not verify your identity");
  const twitter =
    user.data.twitter ??
    (user.data.linked_accounts ?? user.data.linkedAccounts ?? []).find(
      (a) => a.type === "twitter_oauth",
    );
  return {
    privyId: user.data.id,
    name: twitter?.name || twitter?.username || "Tab member",
    twitterSubject: twitter?.subject ?? null,
  };
}
