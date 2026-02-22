import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/playground", "/design"],
      },
    ],
    sitemap: "https://usetab.app/sitemap.xml",
    host: "https://usetab.app",
  };
}
