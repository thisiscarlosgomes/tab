export function shortAddress(address: string): string {
  if (!address) return address;
  const normalized = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) return normalized;
  return `0x${normalized.slice(2, 8)}...${normalized.slice(-4)}`;
}
  
