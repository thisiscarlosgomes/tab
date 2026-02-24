import { Metadata, ResolvingMetadata } from "next";
import ClaimPage from "./client";

export async function generateMetadata(
  { params }: { params: Promise<{ dropId: string }> },
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const { dropId } = await params;

  const frame = {
    version: "next",
    imageUrl: `https://usetab.app/api/og/claim/${dropId}`,
    button: {
      title: "Tap to Claim",
      action: {
        type: "launch_frame",
        name: "tab",
        url: `https://usetab.app/claim/${dropId}`,
        iconImageUrl: "https://usetab.app/newnewnewapp.png",
        splashImageUrl: "https://usetab.app/newnewnewapp.png",
        splashBackgroundColor: "#201E23",
      },
    },
  };

  return {
    title: "Claim Your Drop",
    openGraph: {
      title: "Claim Your Drop",
      images: [`https://usetab.app/api/og/claim/${dropId}`],
    },
    twitter: {
      card: "summary_large_image",
      title: "Claim",
      images: [`https://usetab.app/api/og/claim/${dropId}`],
    },
    other: {
      "fc:frame": JSON.stringify(frame),
    },
  };
}

export default function Page() {
  return <ClaimPage />;
}
