import { Metadata, ResolvingMetadata } from "next";
import SplitPage from "./client";

export async function generateMetadata(
  { params }: { params: Promise<{ splitId: string }> },
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const { splitId } = await params;

  const frame = {
    version: "next",
    imageUrl: `https://usetab.app/api/og/split/${splitId}`,
    button: {
      title: "Pay with tab",
      action: {
        type: "launch_frame",
        name: "tab",
        url: `https://usetab.app/split/${splitId}`,
        iconImageUrl: "https://usetab.app/app.png",
        splashImageUrl: "https://usetab.app/app.png",
        splashBackgroundColor: "#201E23",
      },
    },
  };

  return {
    title: "Bill Split",
    openGraph: {
      title: "Split a Bill",
      images: [`https://usetab.app/api/og/split/${splitId}`],
    },
    twitter: {
      card: "summary_large_image",
      title: "Split a Bill",
      images: [`https://usetab.app/api/og/split/${splitId}`],
    },
    other: {
      "fc:frame": JSON.stringify(frame),
    },
  };
}

export default function Page() {
  return <SplitPage />;
}
