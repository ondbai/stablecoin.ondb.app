import { NextResponse } from 'next/server';
import { getInfo } from '@/lib/stablecoin-utxo';

export async function GET() {
  try {
    const info = await getInfo();
    return NextResponse.json(info);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get info' },
      { status: 500 }
    );
  }
}
