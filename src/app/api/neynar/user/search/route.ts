import { neynarApi } from '@/lib/neynar';
import type { NextRequest } from 'next/server';

export const GET = async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  if (!q) return Response.json([]);

  try {
    const { result } = await neynarApi.searchUser({ q });
    return Response.json(result);
  } catch {
    return Response.json([], { status: 500 });
  }
};
