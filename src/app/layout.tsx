import "./globals.css";

import type { Metadata } from "next";
import type { Viewport } from "next";
import { Providers } from "@/providers/Providers";
// import { FooterNav } from "@/components/footer-nav";
// import { Header } from "@/components/header";
import { Analytics } from "@vercel/analytics/react";
import { AppShell } from "@/components/AppShell";
import "react-loading-skeleton/dist/skeleton.css";

const frame = {
  version: "next",
  imageUrl: `https://usetab.app/cover.png`,
  button: {
    title: "launch tab",
    action: {
      type: "launch_frame",
      name: "tab",
      url: "https://usetab.app",
      iconImageUrl: "https://usetab.app/app.png",
      splashImageUrl: "https://usetab.app/app.png",
      splashBackgroundColor: "#201E23",
    },
  },
};

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL("https://usetab.app"),
    title: "tab",
    openGraph: {
      title: "tab",
      description: "Social payments on Base and Farcaster",
      images: "https://usetab.app/cover.png",
    },
    manifest: "/manifest.json",
    icons: "/app.png",
    other: {
      "fc:frame": JSON.stringify(frame),
    },
  };
}

export const viewport: Viewport = {
  initialScale: 1,
  maximumScale: 1,
  width: "device-width",
};

// eslint-disable-next-line import/no-default-export
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=block"
          rel="stylesheet"
        />
        <meta name="base:app_id" content="68ed7bcce4ceccbd41c31b09" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
      </head>
      <body className="select-none antialiased Text/Faint bg-background text-foreground scrollbar-vert">
        <Providers>
          {/* <Header /> */}
          <AppShell>{children}</AppShell>
          <Analytics />
          {/* <FooterNav /> */}
        </Providers>
        {/* <Providers>
          <Header />
          {children}
          <FooterNav />
        </Providers> */}
      </body>
    </html>
  );
}
