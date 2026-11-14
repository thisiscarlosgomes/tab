import { planChatIntent } from "./plan-chat-intent";

/** Resolve explicit references only; a link identifies a plan, never grants authority. */
export function planChatTarget(
  text: string,
  roomId: string,
  plans: { id: string; title: string }[],
  replyText?: string,
) {
  let intent = planChatIntent(text);
  let named: string[] = [];
  if (!intent) {
    const normalized = text
      .trim()
      .replace(/[.!?]+$/, "")
      .toLowerCase();
    for (const plan of plans) {
      const suffix = ` for ${plan.title
        .trim()
        .replace(/[.!?]+$/, "")
        .toLowerCase()}`;
      if (normalized.endsWith(suffix)) {
        const parsed = planChatIntent(normalized.slice(0, -suffix.length));
        if (parsed) {
          intent = parsed;
          named.push(plan.id);
        }
      }
    }
  }
  if (!intent) return null;
  const links = replyText
    ? [
        ...replyText.matchAll(
          /\/app\/rooms\/([0-9a-f-]{36})\?view=plan&plan=([0-9a-f-]{36})/gi,
        ),
      ]
    : [];
  const linked = [
    ...new Set(links.filter((m) => m[1] === roomId).map((m) => m[2])),
  ];
  const conflicting =
    named.length > 0 &&
    links.length > 0 &&
    (linked.length !== 1 || !named.includes(linked[0]));
  return {
    intent,
    ids: [...new Set([...named, ...linked])],
    explicit: named.length > 0 || links.length > 0,
    invalid: conflicting || links.some((m) => m[1] !== roomId),
  };
}
