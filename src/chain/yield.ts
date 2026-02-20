import { encodeFunctionData, getAddress, parseUnits, type Address } from "viem";
import { base } from "viem/chains";

// ======= Constants =======
export const BASE_CHAIN_ID = base.id;
export const BASE_USDC_ADDR = getAddress(
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
);
export const BASE_AUSDC_ADDR = getAddress(
  "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB"
);
// export const BASE_DEPOSIT_CONTRACT_ADDR = getAddress(
//   "0x2380f715c3A990c30a69Ed871992B0B10187d4C4"
// );

export const BASE_DEPOSIT_CONTRACT_ADDR = getAddress(
  "0xa672B83d8619C541B9500dCbF147162522dcbA9D"
);


// This is the official AAVE Pool Proxy contract address that forwards calls to the implementation
// Using this address matches how the official AAVE UI interacts with the protocol
export const BASE_WITHDRAW_CONTRACT_ADDR = getAddress(
  "0xa238dd80c259a72e81d7e4664a9801593f98d1c5"
);

export const DEPOSIT_CONTRACT_ABI = [
  {
    inputs: [{ name: "recipientAddr", type: "address" }],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "recipientAddr", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
    name: "Deposited",
    type: "event",
  },
] as const;

// Withdraw function ABI based on BaseScan contract
export const WITHDRAW_CONTRACT_ABI = [
  {
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    name: "withdraw",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * Generates a transaction to deposit USDC into mUSDC
 */
export function getDepositCall({ recipientAddr }: { recipientAddr: Address }) {
  return {
    toChain: base,
    toAddress: BASE_DEPOSIT_CONTRACT_ADDR,
    toCallData: encodeFunctionData({
      abi: DEPOSIT_CONTRACT_ABI,
      functionName: "deposit",
      args: [recipientAddr],
    }),
  };
}

/**
 * Generates a transaction to withdraw USDC from the contract
 * This calls the pool contract which uses the standard Aave withdraw interface
 */
export function getWithdrawCall({
  ownerAddr,
  amount,
}: {
  ownerAddr: Address;
  amount: number;
}) {
  return {
    toChain: base,
    toAddress: BASE_WITHDRAW_CONTRACT_ADDR,
    toCallData: encodeFunctionData({
      abi: WITHDRAW_CONTRACT_ABI,
      functionName: "withdraw",
      args: [
        BASE_USDC_ADDR, // asset (USDC contract address)
        parseUnits(amount.toString(), 6), // amount with USDC decimals (6)
        ownerAddr, // to (receiver address)
      ],
    }),
  };
}