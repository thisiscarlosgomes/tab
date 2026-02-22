import type { Connector } from "wagmi";

export function getPreferredConnector(
  connectors: readonly Connector[]
): Connector | undefined {
  const isInIframe =
    typeof window !== "undefined" && window.parent !== window;

  const score = (connector: Connector) => {
    const text = `${connector.id} ${connector.name}`.toLowerCase();

    if (text.includes("privy")) return 100;
    if (isInIframe && text.includes("farcaster")) return 90;
    if (text.includes("injected")) return -100;
    if (text.includes("coinbase")) return -100;
    return 0;
  };

  return connectors
    .filter((connector) => score(connector) > 0)
    .sort((a, b) => score(b) - score(a))[0];
}
