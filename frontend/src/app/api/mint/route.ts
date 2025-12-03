import { NextRequest, NextResponse } from 'next/server';
import { mint, ValidationError, AuthorizationError, RateLimitError } from '@/lib/stablecoin-utxo';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, amount, chainId, paymentTxHash, minterAddress } = body;

    const transaction = await mint(address, amount, chainId, paymentTxHash, minterAddress);
    return NextResponse.json(transaction);
  } catch (error: any) {
    // Handle validation errors (400 Bad Request)
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }

    // Handle authorization errors (403 Forbidden)
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message, code: 'UNAUTHORIZED' },
        { status: 403 }
      );
    }

    // Handle rate limit errors (429 Too Many Requests)
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: error.message, code: 'RATE_LIMITED' },
        { status: 429 }
      );
    }

    // Check if this is a payment required error with quote details
    if (error?.code === 'PAYMENT_REQUIRED' && error?.details) {
      return NextResponse.json(
        {
          error: 'Payment required',
          paymentRequired: true,
          quote: error.details,
        },
        { status: 402 }
      );
    }

    // Generic server error
    console.error('Mint error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to mint' },
      { status: 500 }
    );
  }
}
