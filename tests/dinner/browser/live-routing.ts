export const participantNames = ["Maya", "Leo", "Nina", "Owen"];
export function replyTargets(text: string): number[] {
  const explicit = participantNames.flatMap((name, index) =>
    new RegExp(`@${name}\\b`, "i").test(text) ? [index] : [],
  );
  if (explicit.length) return explicit;
  if (/@tab\b/i.test(text)) return [];
  if (/\b(everyone|everybody|all of you|group)\b/i.test(text))
    return [0, 1, 2, 3];
  const named = participantNames.flatMap((name, index) =>
    new RegExp(`\\b${name}\\b`, "i").test(text) ? [index] : [],
  );
  return named.length ? named : [0, 1, 2, 3];
}
