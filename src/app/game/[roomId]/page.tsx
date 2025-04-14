import { Metadata, ResolvingMetadata } from "next";
import RoomPage from "./client";

export async function generateMetadata(
  { params }: { params: Promise<{ roomId: string }> },
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const { roomId } = await params;

  const frame = {
    version: "next",
    imageUrl: `https://tab.castfriends.com/api/og/room/${roomId}`,
    button: {
      title: "launch tab",
      action: {
        type: "launch_frame",
        name: "tab",
        url: `https://tab.castfriends.com/game/${roomId}`,
        iconImageUrl: "https://tab.castfriends.com/app.png",
        splashImageUrl: "https://tab.castfriends.com/splash.png",
        splashBackgroundColor: "#201E23",
      },
    },
  };

  return {
    title: "join pay roulette",
    openGraph: {
      title: "join pay roulette",
      images: [`https://tab.castfriends.com/api/og/room/${roomId}`],
    },
    twitter: {
      card: "summary_large_image",
      title: "join pay roulette",
      images: [`https://tab.castfriends.com/api/og/room/${roomId}`],
    },
    other: {
      "fc:frame": JSON.stringify(frame),
    },
  };
}

export default function Page() {
  return <RoomPage />;
}
