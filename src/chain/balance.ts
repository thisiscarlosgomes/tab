import { useCallback, useEffect, useState } from "react";
import {
  formatUnits,
  decodeEventLog,
  AbiEvent,
  Log,
  createPublicClient,
  http,
} from "viem";
import { base } from "viem/chains";
import {
  BASE_AUSDC_ADDR,
  BASE_DEPOSIT_CONTRACT_ADDR,
  BASE_WITHDRAW_CONTRACT_ADDR,
  DEPOSIT_CONTRACT_ABI,
  BASE_USDC_ADDR,
} from "./yield";

const ALCHEMY_URL = process.env.NEXT_PUBLIC_ALCHEMY_URL!; // make sure it's public for frontend 

const balanceOfAbi = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const withdrawEventAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "reserve", type: "address" },
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
    name: "Withdraw",
    type: "event",
  },
] as const;

export type TransactionType = "deposit" | "withdraw";
export type Transaction = {
  timestamp: number;
  amountUsd: number;
  url: string;
  type: TransactionType;
};

// use viem client directly
const publicClient = createPublicClient({
  chain: base,
  transport: http(ALCHEMY_URL),
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getLogsInChunks({
  address,
  event,
  args,
  fromBlock,
  toBlock,
  chunkSize = 200n,
}: {
  address: `0x${string}`;
  event: AbiEvent;
  args: Record<string, unknown>;
  fromBlock: bigint;
  toBlock: bigint;
  chunkSize?: bigint;
}) {
  const logs: Log[] = [];

  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;

    try {
      const chunk = await publicClient.getLogs({
        address,
        event,
        args,
        fromBlock: start,
        toBlock: end,
      });

      logs.push(...chunk);
    } catch (err) {
      console.error(`Error fetching logs from ${start} to ${end}:`, err);
    }

    // Add delay between requests (adjust if needed)
    await sleep(300); // 300ms between chunks
  }

  return logs;
}


export function useBalance({ address }: { address?: `0x${string}` | null }) {
  const [balance, setBalance] = useState<number>();
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const fetchBalanceAndTransactions = useCallback(async () => {
    if (!address) return;

    try {
      const fromBlock = BigInt(30020342); // your contract deployment block
      const toBlock = await publicClient.getBlockNumber();

      const [rawBalance, depositLogs, withdrawLogs] = await Promise.all([
        publicClient.readContract({
          address: BASE_AUSDC_ADDR,
          abi: balanceOfAbi,
          functionName: "balanceOf",
          args: [address],
        }),
        getLogsInChunks({
          address: BASE_DEPOSIT_CONTRACT_ADDR,
          event: DEPOSIT_CONTRACT_ABI.find(
            (e) => e.name === "Deposited"
          ) as AbiEvent,
          args: { recipientAddr: address },
          fromBlock,
          toBlock,
        }),
        getLogsInChunks({
          address: BASE_WITHDRAW_CONTRACT_ADDR,
          event: withdrawEventAbi.find(
            (e) => e.name === "Withdraw"
          ) as AbiEvent,
          args: {
            reserve: BASE_USDC_ADDR,
            user: address,
            to: address,
          },
          fromBlock,
          toBlock,
        }),
      ]);

      const formattedBalance = formatUnits(rawBalance, 6);
      setBalance(Number(formattedBalance));

      const getTimestamp = async (blockNumber: bigint): Promise<number> => {
        const block = await publicClient.getBlock({ blockNumber });
        return Number(block.timestamp);
      };

      const deposits = await Promise.all(
        depositLogs.map(async (log) => {
          const decoded = decodeEventLog({
            abi: DEPOSIT_CONTRACT_ABI,
            eventName: "Deposited",
            data: log.data,
            topics: log.topics,
          });

          const amountUsd = Number(
            formatUnits(decoded.args.amount as bigint, 6)
          );
          const timestamp = log.blockNumber
            ? await getTimestamp(log.blockNumber)
            : Date.now();

          return {
            timestamp,
            amountUsd,
            url: `https://basescan.org/tx/${log.transactionHash}`,
            type: "deposit" as const,
          };
        })
      );

      const withdrawals = await Promise.all(
        withdrawLogs.map(async (log) => {
          const decoded = decodeEventLog({
            abi: withdrawEventAbi,
            eventName: "Withdraw",
            data: log.data,
            topics: log.topics,
          });

          const amountUsd = Number(
            formatUnits(decoded.args.amount as bigint, 6)
          );
          const timestamp = log.blockNumber
            ? await getTimestamp(log.blockNumber)
            : Date.now();

          return {
            timestamp,
            amountUsd,
            url: `https://basescan.org/tx/${log.transactionHash}`,
            type: "withdraw" as const,
          };
        })
      );

      const allTransactions = [...deposits, ...withdrawals].sort(
        (a, b) => b.timestamp - a.timestamp
      );

      setTransactions(allTransactions);
    } catch (err) {
      console.error("Error fetching balance or transactions:", err);
      setBalance(undefined);
      setTransactions([]);
    }
  }, [address]);

  // useEffect(() => {
  //   fetchBalanceAndTransactions();
  // }, [fetchBalanceAndTransactions]);

  return { balance, transactions, refetch: fetchBalanceAndTransactions };
}
