import { parseAbi } from "viem";
import client from "./viem-client";
import {
  CONTRACT_ADDRESS,
  ERC20_TOKEN_ADDRESS,
  JACKPOT_TICKET_NFT_ADDRESS,
  RANDOM_TICKET_BUYER_ADDRESS,
} from "./constants";

const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

const jackpotAbi = parseAbi([
  "function currentDrawingId() view returns (uint256)",
  "function getDrawingState(uint256 drawingId) view returns ((uint256 prizePool,uint256 ticketPrice,uint256 edgePerTicket,uint256 referralWinShare,uint256 referralFee,uint256 globalTicketsBought,uint256 lpEarnings,uint256 drawingTime,uint256 winningTicket,uint8 ballMax,uint8 bonusballMax,address payoutCalculator,bool jackpotLock))",
]);

const ticketNftAbi = parseAbi([
  "function getUserTickets(address user, uint256 drawingId) view returns ((uint256 ticketId,uint256 drawingId,address owner,uint8[] normals,uint8 bonusball,uint256 purchaseTimestamp,uint8 tier,bool claimed)[])",
]);

async function getCurrentDrawing() {
  const drawingId = (await client.readContract({
    address: CONTRACT_ADDRESS,
    abi: jackpotAbi,
    functionName: "currentDrawingId",
  })) as bigint;

  const state = (await client.readContract({
    address: CONTRACT_ADDRESS,
    abi: jackpotAbi,
    functionName: "getDrawingState",
    args: [drawingId],
  })) as {
    prizePool: bigint;
    ticketPrice: bigint;
    referralFee: bigint;
    drawingTime: bigint;
  };

  return { drawingId, state };
}

export async function getTicketPrice(): Promise<bigint | undefined> {
  try {
    const { state } = await getCurrentDrawing();
    return state.ticketPrice;
  } catch (error) {
    console.error("Error getting ticket price:", error);
    return undefined;
  }
}

export async function getJackpotAmount(): Promise<bigint | undefined> {
  try {
    const { state } = await getCurrentDrawing();
    return state.prizePool;
  } catch (error) {
    console.error("Error getting jackpot amount:", error);
    return undefined;
  }
}

export async function getTimeRemaining(): Promise<number | undefined> {
  try {
    const { state } = await getCurrentDrawing();
    return Number(state.drawingTime) - Date.now() / 1000;
  } catch (error) {
    console.error("Error getting time remaining:", error);
    return undefined;
  }
}

export async function getLpsInfo(
  _address: `0x${string}`
): Promise<[bigint, bigint, bigint, boolean] | undefined> {
  return undefined;
}

export async function getFeeBps(): Promise<number | undefined> {
  try {
    const { state } = await getCurrentDrawing();
    return Number((state.referralFee * 10000n) / 10n ** 18n);
  } catch (error) {
    console.error("Error getting fee bps:", error);
    return undefined;
  }
}

export async function getJackpotOdds(): Promise<number | undefined> {
  try {
    const jackpotAmountWei = await getJackpotAmount();
    const ticketPriceWei = await getTicketPrice();
    const tokenDecimals = await getTokenDecimals();

    if (
      jackpotAmountWei === undefined ||
      ticketPriceWei === undefined ||
      tokenDecimals === undefined ||
      tokenDecimals === 0 ||
      ticketPriceWei === 0n
    ) {
      return undefined;
    }

    const jackpotSizeNum = Number(jackpotAmountWei) / 10 ** tokenDecimals;
    const ticketPriceNum = Number(ticketPriceWei) / 10 ** tokenDecimals;
    if (ticketPriceNum === 0) return undefined;
    return jackpotSizeNum / ticketPriceNum;
  } catch (error) {
    console.error("Error getting jackpot odds:", error);
    return undefined;
  }
}

export async function getUsersInfo(_address: `0x${string}`): Promise<
  | {
      ticketsPurchasedTotalBps: bigint;
      winningsClaimable: bigint;
      active: boolean;
    }
  | undefined
> {
  return undefined;
}

export async function getTicketCountForRound(
  address: `0x${string}`
): Promise<number | undefined> {
  try {
    const { drawingId } = await getCurrentDrawing();
    const tickets = (await client.readContract({
      address: JACKPOT_TICKET_NFT_ADDRESS,
      abi: ticketNftAbi,
      functionName: "getUserTickets",
      args: [address, drawingId],
    })) as unknown[];
    return tickets.length;
  } catch (error) {
    console.error("Error getting ticket count for round:", error);
    return undefined;
  }
}

export async function getTokenName(): Promise<string | undefined> {
  try {
    const name = await client.readContract({
      address: ERC20_TOKEN_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "name",
    });
    return name as string;
  } catch (error) {
    console.error("Error getting token name:", error);
    return undefined;
  }
}

export async function getTokenSymbol(): Promise<string | undefined> {
  try {
    const symbol = await client.readContract({
      address: ERC20_TOKEN_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "symbol",
    });
    return symbol as string;
  } catch (error) {
    console.error("Error getting token symbol:", error);
    return undefined;
  }
}

export async function getTokenDecimals(): Promise<number | undefined> {
  try {
    const decimals = await client.readContract({
      address: ERC20_TOKEN_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "decimals",
    });
    return Number(decimals);
  } catch (error) {
    console.error("Error getting token decimals:", error);
    return undefined;
  }
}

export async function getTokenBalance(
  address: `0x${string}`
): Promise<bigint | undefined> {
  try {
    const balance = await client.readContract({
      address: ERC20_TOKEN_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
    return balance as bigint;
  } catch (error) {
    console.error("Error getting token balance:", error);
    return undefined;
  }
}

export async function getTokenAllowance(
  address: `0x${string}`
): Promise<bigint | undefined> {
  try {
    const allowance = await client.readContract({
      address: ERC20_TOKEN_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, RANDOM_TICKET_BUYER_ADDRESS],
    });
    return allowance as bigint;
  } catch (error) {
    console.error("Error getting token allowance:", error);
    return undefined;
  }
}

export async function getLpPoolStatus(): Promise<boolean | undefined> {
  return undefined;
}

export async function getMinLpDeposit(): Promise<bigint | undefined> {
  return undefined;
}

interface LastJackpotEvent {
  time: number;
  winner: string;
  winningTicket: number;
  winAmount: bigint;
  ticketsPurchasedTotalBps: bigint;
}

export async function getLastJackpotResults(): Promise<
  LastJackpotEvent | undefined
> {
  return undefined;
}
