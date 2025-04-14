import { useFundWallet } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function FundButton() {
  const { fundWallet } = useFundWallet();
  const { address, isConnected } = useAccount();

  const onFund = async () => {
    if (!address || !isConnected) return;
    await fundWallet(address);
  };

  const isDisabled = !address || !isConnected;

  return (
    <div className="relative">
      {!isDisabled && (
        <div className="absolute inset-0 bg-gradient-to-b from-blue-500 to-purple-500 blur-lg rounded-lg opacity-50" />
      )}
      <Button
        disabled={isDisabled}
        size="sm"
        className={cn(
          "py-1 px-3 disabled:opacity-30 disabled:cursor-not-allowed relative bg-white",
          "shadow-md hover:shadow-lg transition-all duration-200"
        )}
        onClick={onFund}
      >
        Fund Wallet
      </Button>
    </div>
  );
}
