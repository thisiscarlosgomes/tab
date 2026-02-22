import { createConfig, WagmiProvider } from "@privy-io/wagmi";
import { http } from "wagmi";
import { base } from "wagmi/chains";

export const config = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(process.env.ALCHEMY_URL!), // ✅ REQUIRED
  },
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return <WagmiProvider config={config}>{children}</WagmiProvider>;
}
