/**
 * Fetches current ETH price in USD from CoinGecko (free, no API key required)
 */
export async function getEthPriceInUsd(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    { next: { revalidate: 60 } } // Cache for 60 seconds in Next.js
  );
  const data = await res.json();
  return data.ethereum.usd;
}

/**
 * Converts a given USD amount to ETH based on current live price
 */
export async function convertUsdToEth(usdAmount: number): Promise<{
  ethAmount: number;
  ethPriceUsd: number;
}> {
  if (usdAmount <= 0) return { ethAmount: 0, ethPriceUsd: 0 };

  const ethPriceUsd = await getEthPriceInUsd();
  if (ethPriceUsd <= 0) throw new Error("Invalid ETH price received");

  const ethAmount = usdAmount / ethPriceUsd;

  return {
    ethAmount: Number(ethAmount.toFixed(6)), // Display with 6 decimal precision
    ethPriceUsd,
  };
}