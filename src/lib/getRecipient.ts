import { resolveRecipient } from "@/lib/recipient-resolver";

export const getRecipient = async (recipient: string): Promise<string | null> => {
  const resolved = await resolveRecipient({ recipient });
  return resolved?.address ?? null;
};
