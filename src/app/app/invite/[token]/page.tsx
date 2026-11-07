import { Invite } from "@/components/dinner/Invite";
export const metadata = { referrer: "no-referrer" };
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <Invite token={(await params).token} />;
}
