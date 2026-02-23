import { Metadata } from "next";
import ReceivePageClient from "./client";

export async function generateMetadata(): Promise<Metadata> {
  const frame = {
    version: "vNext",
    imageUrl: `https://usetab.app/cover.png`,
    button: {
      title: "launch tab",
      action: {
        type: "launch_frame",
        name: "tab",
        url: `https://usetab.app/r`,
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
      images: [`https://usetab.app/cover.png`],
    },
    twitter: {
      card: "summary_large_image",
      title: "pay with tab",
      images: [`https://usetab.app/cover.png`],
    },
    other: {
      "fc:frame": JSON.stringify(frame),
    },
  };
}

export default function Page() {
  return <ReceivePageClient />;
}
