import { Address } from "viem";

export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_MEGAPOT_JACKPOT_ADDRESS ??
  "0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2") as Address; // Megapot Jackpot Contract (v2)
const usdcAddressFromEnv = process.env.NEXT_PUBLIC_ERC20_TOKEN_ADDRESS as
  | Address
  | undefined;
export const USDC_ADDRESS = (usdcAddressFromEnv ??
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as Address; // USDC on Base
export const JACKPOT_TICKET_NFT_ADDRESS = (process.env
  .NEXT_PUBLIC_MEGAPOT_TICKET_NFT_ADDRESS ??
  "0x48FfE35AbB9f4780a4f1775C2Ce1c46185b366e4") as Address;
export const RANDOM_TICKET_BUYER_ADDRESS = (process.env
  .NEXT_PUBLIC_MEGAPOT_RANDOM_BUYER_ADDRESS ??
  "0xb9560b43b91dE2c1DaF5dfbb76b2CFcDaFc13aBd") as Address;
export const JACKPOT_AUTO_SUBSCRIPTION_ADDRESS = (process.env
  .NEXT_PUBLIC_MEGAPOT_AUTO_SUBSCRIPTION_ADDRESS ??
  "0x02A58B725116BA687D9356Eafe0fA771d58a37ac") as Address;

// Kept for backward compatibility with existing imports.
export const ERC20_TOKEN_ADDRESS = USDC_ADDRESS;
export const CONTRACT_START_BLOCK = 27077440;
export const PURCHASE_TICKET_TOPIC =
  "0xd72c70202ab87b3549553b1d4ceb2a632c83cb96fa2dfe65c30282862fe11ade";
export const JACKPOT_RUN_TOPIC =
  "0x3208da215cdfa0c44cf3d81565b27f57d4c505bf1a48e40957e53aaf3ba2aa82";

export const USDC_DECIMALS = 6;

// Referral Address
export const REFERRER_ADDRESS = "0x0334eEb5D4D43660dC6Cec60c2a2eB9935aF5EC0";
export const REFERRAL_SPLIT_PRECISE_UNIT = 10n ** 18n;
export const APP_SOURCE_BYTES32 =
  "0x7461620000000000000000000000000000000000000000000000000000000000";
