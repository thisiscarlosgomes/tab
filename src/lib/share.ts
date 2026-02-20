export function getShareUrl({
  name,
  username,
  description,
  url = "https://usetab.app", // default fallback
}: {
  name: string;
  username?: string;
  description?: string;
  url?: string;
}) {
  name;
  const text = description
    ? description
    : username
      ? `Tab cleared. Your turn next.`
      : `Just picked up the Tab. Your turn next.`;

  return `https://warpcast.com/~/compose?text=${encodeURIComponent(
    text
  )}&embeds[]=${encodeURIComponent(url)}`;
}
