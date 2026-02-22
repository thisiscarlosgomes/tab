export type AgentAccessStatus = "ACTIVE" | "PAUSED" | "REVOKED";
export type AgentRecipientMode = "split_participants";

export interface AgentAccessRecord {
  userId: string;
  address: string;
  walletId: string | null;
  delegated: boolean;
  status: AgentAccessStatus;
  allowedToken: string;
  maxPerPayment: number;
  dailyCap: number;
  recipientMode: AgentRecipientMode;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_AGENT_POLICY = {
  allowedToken: "USDC",
  maxPerPayment: 10,
  dailyCap: 50,
  recipientMode: "split_participants" as AgentRecipientMode,
  expiresInDays: 30,
};

export function getPolicyExpiry(days: number): Date | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  const now = Date.now();
  return new Date(now + days * 24 * 60 * 60 * 1000);
}

export function getStartOfDayUtc(date = new Date()): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

export function getNextDayUtc(date = new Date()): Date {
  const start = getStartOfDayUtc(date);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

