import { Metadata, ResolvingMetadata } from "next";
import GroupClaimPage from "./client";

export async function generateMetadata(
  { params }: { params: Promise<{ groupId: string }> },
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const { groupId } = await params;

  const frame = {
    version: "next",

    imageUrl: `https://usetab.app/api/og/claims/group/${groupId}`,
    button: {
      title: "Tap to Claim",
      action: {
        type: "launch_frame",
        name: "tab",
        url: `https://usetab.app/claims/group/${groupId}`,
        iconImageUrl: "https://usetab.app/newnewapp.png",
        splashImageUrl: "https://usetab.app/newnewapp.png",
        splashBackgroundColor: "#201E23",
      },
    },
  };

  return {
    title: "Claim Your Drop",
    openGraph: {
      title: "Claim Your Drop",
      images: [`https://usetab.app/api/og/claims/group/${groupId}`],
    },
    twitter: {
      card: "summary_large_image",
      title: "Claim",
      images: [`https://usetab.app/api/og/claims/group/${groupId}`],
    },
    other: {
      "fc:frame": JSON.stringify(frame),
    },
  };
}

export default function Page() {
  return <GroupClaimPage />;
}
