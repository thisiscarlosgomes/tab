export function getShareUrl({
  name,
  username,
  description,
}: {
  name: string;
  username?: string;
  description?: string;
}) {
  name;
  const text = description
    ? description
    : username
      ? `That was smooth. Let’s see who’s next tab!`
      : `That was smooth. Let’s see who’s next on tab!`;

  return `https://warpcast.com/~/compose?text=${encodeURIComponent(
    text
  )}&embeds[]=${encodeURIComponent("https://tab.castfriends.com")}`;
}
