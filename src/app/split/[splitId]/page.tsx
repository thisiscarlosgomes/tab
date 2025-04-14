import { Metadata, ResolvingMetadata } from "next";
import SplitPage from "./client";

export async function generateMetadata(
  { params }: { params: Promise<{ splitId: string }> },
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const { splitId } = await params;

  const frame = {
    version: "next",
    imageUrl: `https://tab.castfriends.com/api/og/split/${splitId}`,
    button: {
      title: "launch tab",
      action: {
        type: "launch_frame",
        name: "tab",
        url: `https://tab.castfriends.com/split/${splitId}`,
        iconImageUrl: "https://tab.castfriends.com/app.png",
        splashImageUrl: "https://tab.castfriends.com/splash.png",
        splashBackgroundColor: "#201E23",
      },
    },
  };

  return {
    title: "Group Bill",
    openGraph: {
      title: "Split a Bill",
      images: [`https://tab.castfriends.com/api/og/split/${splitId}`],
    },
    twitter: {
      card: "summary_large_image",
      title: "Split a Bill",
      images: [`https://tab.castfriends.com/api/og/split/${splitId}`],
    },
    other: {
      "fc:frame": JSON.stringify(frame),
    },
  };
}

export default function Page() {
  return <SplitPage />;
}
