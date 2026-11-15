export function planChatIntent(
  text: string,
): "opt_out" | "proceed" | "negotiate" | "rejoin" | null {
  const value = text
    .replace(/@tab\b/gi, "")
    .replace(/[’]/g, "'")
    .replace(/[.,!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (
    /^(?:i want to rejoin|i can make it after all|count me back in)$/.test(
      value,
    )
  )
    return "rejoin";
  if (
    /^(?:i can't make it|i cannot make it|i'm not going|i am not going|count me out|go ahead without me|i can't make it go ahead without me|i'm not going go ahead without me)$/.test(
      value,
    )
  )
    return "opt_out";
  if (
    /^(?:yes )?(?:go ahead|go ahead with the people who accepted|lock it in for those who accepted|keep the plan for those who accepted)$/.test(
      value,
    )
  )
    return "proceed";
  if (/^(?:can|could) we (?:do (?:it )?|meet )?later$/.test(value))
    return "negotiate";
  return null;
}
