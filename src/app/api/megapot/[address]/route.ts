import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // Required for dynamic params in App Router

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
): Promise<NextResponse> {
  const { address } = await params;
  const API_KEY = process.env.MEGAPOT_API_KEY;

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  if (!API_KEY) {
    return NextResponse.json({ error: 'Missing API key' }, { status: 500 });
  }

  try {
    const [contractRes, guaranteedRes] = await Promise.all([
      fetch(
        `https://api.megapot.io/api/v1/contracts/0xbEDd4F2beBE9E3E636161E644759f3cbe3d51B95/${address}`,
        {
          headers: { apikey: API_KEY },
          next: { revalidate: 3600 },
        }
      ),
      fetch(
        `https://api.megapot.io/api/v1/giveaways/daily-giveaway-winners/${address}`,
        {
          headers: { apikey: API_KEY },
          next: { revalidate: 3600 },
        }
      ),
    ]);

    if (!contractRes.ok || !guaranteedRes.ok) {
      throw new Error('Failed to fetch one or more Megapot endpoints');
    }

    const [contractData, guaranteedPrizes] = await Promise.all([
      contractRes.json(),
      guaranteedRes.json(),
    ]);

    return NextResponse.json({
      contractData,
      guaranteedPrizes,
    });
  } catch (err) {
    console.error('Megapot API error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch Megapot data' },
      { status: 500 }
    );
  }
}
