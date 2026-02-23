import { Metadata, ResolvingMetadata } from "next";
import JackpotPage from "./client";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const { slug } = await params;

  const frame = {
    version: "next",
    imageUrl: `https://usetab.app/coverj.png`,
    button: {
      title: "Enter Now",
      action: {
        type: "launch_frame",
        name: "tab",
        url: "https://usetab.app/jackpot",
        iconImageUrl: "https://usetab.app/newnewapp.png",
        splashImageUrl: "https://usetab.app/newnewapp.png",
        splashBackgroundColor: "#201E23",
      },
    },
  };

  return {
    title: "tab jackpot",
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
  return <JackpotPage />;
}
