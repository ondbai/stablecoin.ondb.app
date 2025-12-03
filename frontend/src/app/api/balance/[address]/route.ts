import { NextRequest, NextResponse } from 'next/server';
import { getBalance } from '@/lib/stablecoin-utxo';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const balance = await getBalance(address);
    return NextResponse.json(balance);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get balance' },
      { status: 500 }
    );
  }
}
