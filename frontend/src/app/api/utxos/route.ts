import { NextRequest, NextResponse } from 'next/server';
import { getUnspentUTXOs } from '@/lib/stablecoin-utxo';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    if (!address) {
      return NextResponse.json(
        { error: 'Address parameter is required' },
        { status: 400 }
      );
    }

    const utxos = await getUnspentUTXOs(address);
    return NextResponse.json(utxos);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get UTXOs' },
      { status: 500 }
    );
  }
}
