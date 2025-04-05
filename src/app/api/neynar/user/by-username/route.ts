import { neynarApi } from '@/lib/neynar';
import type { NextRequest } from 'next/server';

export const GET = async (req: NextRequest) => {
  const username = req.nextUrl.searchParams.get('username') ?? '';
  if (!username) return Response.json(null, { status: 400 });

  try {
    const { user } = await neynarApi.lookupUserByUsername({ username });
    return Response.json(user);
  } catch {
    return Response.json(null, { status: 404 });
  }
};
