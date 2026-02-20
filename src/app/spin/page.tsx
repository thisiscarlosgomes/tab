import { Metadata, ResolvingMetadata } from "next";
import DailySpin from "./client";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const { slug } = await params;

  const frame = {
    version: "next",
    imageUrl: `https://usetab.app/cover.png`,
    button: {
      title: "launch tab",
      action: {
        type: "launch_frame",
        name: "tab",
        url: "https://usetab.app/spin",
        iconImageUrl: "https://usetab.app/app.png",
        splashImageUrl: "https://usetab.app/app.png",
        splashBackgroundColor: "#201E23",
      },
    },
  };

  return {
    title: "tab Daily Spin",
    openGraph: {
      title: "pay with tab",
      images: [`https://usetab.app/cover.png`],
    },
    twitter: {
      card: "summary_large_image",
      title: "pay with tab",
      images: "https://usetab.app/cover.png",
    },
    other: {
      "fc:frame": JSON.stringify(frame),
    },
  };
}

export default function Page() {
  return <DailySpin />;
}

