export const getTokenPrices = async (): Promise<Record<string, number>> => {
  const prices: Record<string, number> = {};

  // 1. Fetch ETH, WETH, USDC, EURC from CoinGecko
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,weth,usd-coin,cad-coin, brz,idrx,real-mxn,euro-coin&vs_currencies=usd"
    );
    const data = await res.json();

    if (data?.ethereum?.usd) prices["ETH"] = data.ethereum.usd;
    if (data?.["weth"]?.usd) prices["WETH"] = data["weth"].usd;
    if (data?.["usd-coin"]?.usd) prices["USDC"] = data["usd-coin"].usd;
    if (data?.["euro-coin"]?.usd) prices["EURC"] = data["euro-coin"].usd;
    if (data?.["brz"]?.usd) prices["BRZ"] = data["brz"].usd;
  } catch (err) {
    console.error("CoinGecko price fetch failed:", err);
  }

  return prices;
};
