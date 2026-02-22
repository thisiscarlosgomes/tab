import type { MetadataRoute } from "next";

const BASE_URL = "https://usetab.app";
const PUBLIC_ROUTES: Array<{
  path: string;
  changeFrequency: "daily" | "weekly" | "monthly";
  priority: number;
}> = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/faq", changeFrequency: "weekly", priority: 0.8 },
  { path: "/jackpot", changeFrequency: "daily", priority: 0.8 },
  { path: "/spin", changeFrequency: "weekly", priority: 0.7 },
  { path: "/leaderboard", changeFrequency: "daily", priority: 0.7 },
  { path: "/r", changeFrequency: "weekly", priority: 0.6 },
  { path: "/table", changeFrequency: "weekly", priority: 0.5 },
  { path: "/join-split", changeFrequency: "weekly", priority: 0.5 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: `${BASE_URL}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
