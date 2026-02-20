import { useAccount } from "wagmi";
import { useWallets } from "@privy-io/react-auth";

export function useUserAddress() {
  const { address, isConnected } = useAccount();
  const { wallets } = useWallets();

  return isConnected && address ? address : wallets[0]?.address ?? null;
}
