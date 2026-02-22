export function normalizeAddress(address?: string | null): string | null {
  if (!address) return null;
  return address.toLowerCase();
}

export function derivePseudoFid(address: string): number {
  const normalized = address.toLowerCase();
  let hash = 0;

  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }

  // keep within positive 31-bit range and non-zero
  return (hash % 2_147_483_647) + 1;
}

export function resolveUserFid(params: {
  fid?: number | string | null;
  address?: string | null;
}): number | null {
  const rawFid = params.fid;
  if (rawFid !== undefined && rawFid !== null && rawFid !== "") {
    const numericFid = Number(rawFid);
    if (Number.isFinite(numericFid) && numericFid > 0) {
      return numericFid;
    }
  }

  const normalized = normalizeAddress(params.address);
  if (!normalized) return null;
  return derivePseudoFid(normalized);
}

export function buildUserKey(params: {
  fid?: number | string | null;
  address?: string | null;
}): string | null {
  const normalized = normalizeAddress(params.address);
  if (normalized) return `wallet:${normalized}`;

  const fid = resolveUserFid(params);
  if (fid) return `fid:${fid}`;
  return null;
}
