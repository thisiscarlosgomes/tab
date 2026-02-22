import "./globals.css";

import type { Metadata } from "next";
import type { Viewport } from "next";
import { Providers } from "@/providers/Providers";
// import { FooterNav } from "@/components/footer-nav";
// import { Header } from "@/components/header";
import { Analytics } from "@vercel/analytics/react";
import { AppShell } from "@/components/AppShell";
import "react-loading-skeleton/dist/skeleton.css";

const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://usetab.app";
const SITE_NAME = "Tab";
const DEFAULT_TITLE = "Tab";
const DEFAULT_DESCRIPTION = "Split bills, send crypto, and get paid in seconds on Base.";

const frame = {
  version: "next",
  imageUrl: `${SITE_ORIGIN}/cover.png`,
  button: {
    title: "launch tab",
    action: {
      type: "launch_frame",
      name: "Tab",
      url: SITE_ORIGIN,
      iconImageUrl: `${SITE_ORIGIN}/app.png`,
      splashImageUrl: `${SITE_ORIGIN}/app.png`,
      splashBackgroundColor: "#201E23",
    },
  },
};

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: {
      default: DEFAULT_TITLE,
      template: "%s | Tab",
    },
    description: DEFAULT_DESCRIPTION,
    applicationName: SITE_NAME,
    keywords: [
      "split bills",
      "crypto payments",
      "base app",
      "group payments",
      "send USDC",
      "tab app",
    ],
    category: "finance",
    openGraph: {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      url: SITE_ORIGIN,
      siteName: SITE_NAME,
      locale: "en_US",
      type: "website",
      images: [
        {
          url: `${SITE_ORIGIN}/cover.png`,
          width: 1200,
          height: 630,
          alt: "Tab app preview",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      images: [`${SITE_ORIGIN}/cover.png`],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    manifest: "/manifest.json",
    icons: {
      icon: [
        { url: "/app.png" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [
        {
          url: "/icons/apple-touch-icon.png",
          sizes: "180x180",
          type: "image/png",
        },
      ],
      shortcut: ["/app.png"],
    },
    appleWebApp: {
      capable: true,
      title: "Tab",
      statusBarStyle: "black-translucent",
    },
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
    other: {
      "mobile-web-app-capable": "yes",
      "apple-mobile-web-app-capable": "yes",
      "fc:frame": JSON.stringify(frame),
    },
  };
}

export const viewport: Viewport = {
  initialScale: 1,
  width: "device-width",
  viewportFit: "cover",
  themeColor: "#0A0A14",
};

// eslint-disable-next-line import/no-default-export
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_ORIGIN,
      potentialAction: {
        "@type": "SearchAction",
        target: `${SITE_ORIGIN}/receive/{username}`,
        "query-input": "required name=username",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: SITE_NAME,
      applicationCategory: "FinanceApplication",
      operatingSystem: "iOS, Android, Web",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      description: DEFAULT_DESCRIPTION,
      url: SITE_ORIGIN,
    },
  ];

  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <meta name="base:app_id" content="68ed7bcce4ceccbd41c31b09" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
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
