import type { NextRequest } from 'next/server';
import { fetchFarcasterUsersByAddresses } from '@/lib/proxy';

export async function GET(req: NextRequest) {
  const address = req.nextUrl.pathname.split('/').pop()?.toLowerCase();

  if (!address)
    return Response.json({ error: 'Missing address' }, { status: 400 });

  try {
    const farcasterUser = await fetchFarcasterUsersByAddresses(address);
    return Response.json(farcasterUser[address] ?? null);
  } catch {
    return Response.json(null, { status: 404 });
  }
}
