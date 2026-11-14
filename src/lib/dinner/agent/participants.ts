import { stripTabAddress } from "./awareness-schema";
/** Conservative evidence check for receipt participants. Unclear selections need clarification. */
export function selectedParticipants(
  texts: string[],
  members: { userId: string; name: string }[],
  requesterId: string,
): string[] | null {
  for (const raw of [...texts].reverse()) {
    const text = stripTabAddress(raw)
      .replace(/@tab\b/gi, "")
      .trim()
      .toLowerCase();
    // Exclusions and ambiguous names need a clearer selection, not inference.
    if (/\b(except|excluding|not|without)\b/.test(text)) return null;
    if (/\b(everyone|everybody|all of us|all (?:room )?members)\b/.test(text))
      return members.map((m) => m.userId);
    if (
      members.length === 2 &&
      /\b(both of us|we both|the two of us)\b/.test(text)
    )
      return members.map((m) => m.userId);
    const selected = members.filter((member) => {
      const name = member.name.toLowerCase();
      if (members.filter((m) => m.name.toLowerCase() === name).length !== 1)
        return false;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return (
        new RegExp(
          `(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
          "u",
        ).test(text) ||
        text.split(/[^a-z0-9-]+/).includes(member.userId) ||
        (member.userId === requesterId && /\b(me|myself)\b/.test(text))
      );
    });
    if (
      selected.length &&
      /\b(split|share|between|participants|and)\b|,/.test(text)
    )
      return selected.map((m) => m.userId);
  }
  return null;
}
