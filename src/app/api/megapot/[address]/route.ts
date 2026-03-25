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
    const [ticketPurchasesRes, guaranteedRes] = await Promise.all([
      fetch(
        `https://api.megapot.io/api/v1/ticket-purchases/${address}`,
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

    if (!ticketPurchasesRes.ok && !guaranteedRes.ok) {
      throw new Error('All Megapot endpoints failed');
    }

    const [ticketPurchasesParsed, guaranteedPrizesParsed] = await Promise.allSettled([
      ticketPurchasesRes.ok ? ticketPurchasesRes.json() : Promise.resolve([]),
      guaranteedRes.ok ? guaranteedRes.json() : Promise.resolve({}),
    ]);

    const ticketPurchases =
      ticketPurchasesParsed.status === 'fulfilled' ? ticketPurchasesParsed.value : [];
    const guaranteedPrizes =
      guaranteedPrizesParsed.status === 'fulfilled' ? guaranteedPrizesParsed.value : {};
    return NextResponse.json({
      ticketPurchases,
      contractData: null,
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
