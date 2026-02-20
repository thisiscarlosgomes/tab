import { Address } from "viem";

export const CONTRACT_ADDRESS = process.env
  .NEXT_PUBLIC_CONTRACT_ADDRESS! as Address; // Megapot Jackpot Contract
export const ERC20_TOKEN_ADDRESS = process.env
  .NEXT_PUBLIC_ERC20_TOKEN_ADDRESS! as Address; // USDC on Base
export const CONTRACT_START_BLOCK = 27077440;
export const PURCHASE_TICKET_TOPIC =
  "0xd72c70202ab87b3549553b1d4ceb2a632c83cb96fa2dfe65c30282862fe11ade";
export const JACKPOT_RUN_TOPIC =
  "0x3208da215cdfa0c44cf3d81565b27f57d4c505bf1a48e40957e53aaf3ba2aa82";

export const USDC_DECIMALS = 6;

// Referral Address
export const REFERRER_ADDRESS = "0x760c510C1F9d504eA08c2c3281CC030a4Cc625BB";
