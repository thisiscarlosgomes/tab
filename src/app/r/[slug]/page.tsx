import { Metadata } from "next";
import ReceivePageClient from "./client"; // client component

export const metadata: Metadata = {
  openGraph: {
    title: "tab - request ETH",
    type: "website",
    description: "Social payments on Farcaster",
    images: "https://tab.castfriends.com/cover.png",
  },
};

export default function Page() {
  return <ReceivePageClient />;
}