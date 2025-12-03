import { NextRequest, NextResponse } from 'next/server';
import { getHistory } from '@/lib/stablecoin-utxo';
import { PaymentRequiredError, X402Quote } from '@onchaindb/sdk';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address') || undefined;
    const transactions = await getHistory(address);
    return NextResponse.json(transactions);
  } catch (error) {
    // Handle PaymentRequiredError - return 402 with quote for frontend payment flow
    if (error instanceof PaymentRequiredError) {
      return NextResponse.json(
        { quote: error.quote },
        { status: 402 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get history' },
      { status: 500 }
    );
  }
}
