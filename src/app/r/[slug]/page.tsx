import { Metadata, ResolvingMetadata } from "next";
import ReceivePageClient from "./client";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const { slug } = await params;

  const frame = {
    version: "next",
    imageUrl: `https://usetab.app/api/og/receive/${slug}`,
    button: {
      title: "launch tab",
      action: {
        type: "launch_frame",
        name: "tab",
        url: `https://usetab.app/r/${slug}`,
        iconImageUrl: "https://usetab.app/newnewapp.png",
        splashImageUrl: "https://usetab.app/newnewapp.png",
        splashBackgroundColor: "#201E23",
      },
    },
  };

  return {
    title: "pay with tab",
    openGraph: {
      title: "pay with tab",
      images: [`https://usetab.app/api/og/receive/${slug}`],
    },
    twitter: {
      card: "summary_large_image",
      title: "pay with tab",
      images: [`https://usetab.app/api/og/receive/${slug}`],
    },
    other: {
      "fc:frame": JSON.stringify(frame),
    },
  };
}

export default function Page() {
  return <ReceivePageClient />;
}

