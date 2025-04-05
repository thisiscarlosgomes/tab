export function shortAddress(address: string): string {
    if (!address || address.length !== 42) return address; // Ensure address is valid
    return `${address.slice(0, 5)}...${address.slice(-4)}`; // Shorten to `0x123...234`
  }
  