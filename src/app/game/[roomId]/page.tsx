import { Metadata, ResolvingMetadata } from "next";
import RoomPage from "./client";

export async function generateMetadata(
  { params }: { params: Promise<{ roomId: string }> },
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const { roomId } = await params;

  const frame = {
    version: "next",
    imageUrl: `https://usetab.app/api/og/room/${roomId}`,
    button: {
      title: "Spin the tab",
      action: {
        type: "launch_frame",
        name: "tab",
        url: `https://usetab.app/game/${roomId}`,
        iconImageUrl: "https://usetab.app/app.png",
        splashImageUrl: "https://usetab.app/app.png",
        splashBackgroundColor: "#201E23",
      },
    },
  };

  return {
    title: "Spin the tab",
    openGraph: {
      title: "randomly decide who pays",
      images: [`https://usetab.app/api/og/room/${roomId}`],
    },
    twitter: {
      card: "summary_large_image",
      title: "Spin the tab",
      images: [`https://usetab.app/api/og/room/${roomId}`],
    },
    other: {
      "fc:frame": JSON.stringify(frame),
    },
  };
}

export default function Page() {
  return <RoomPage />;
}
