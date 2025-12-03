import { NextRequest, NextResponse } from 'next/server';
import { burn, ValidationError, RateLimitError, SignatureError, SignedTransactionRequest } from '@/lib/stablecoin-utxo';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, amount, paymentTxHash, signedRequest } = body;

    // Build signed request if provided (input references model)
    let signedTransactionRequest: SignedTransactionRequest | undefined;
    if (signedRequest) {
      signedTransactionRequest = {
        inputs: signedRequest.inputs,
        outputs: signedRequest.outputs,
        signature: {
          message: signedRequest.signature.message,
          signature: signedRequest.signature.signature,
          publicKey: signedRequest.signature.publicKey,
        },
      };
    }

    const transaction = await burn(address, amount, paymentTxHash, signedTransactionRequest);
    return NextResponse.json(transaction);
  } catch (error: unknown) {
    // Handle signature errors (401 Unauthorized)
    if (error instanceof SignatureError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 401 }
      );
    }

    // Handle validation errors (400 Bad Request)
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
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
    const err = error as { code?: string; details?: unknown };
    if (err?.code === 'PAYMENT_REQUIRED' && err?.details) {
      return NextResponse.json(
        {
          error: 'Payment required',
          paymentRequired: true,
          quote: err.details,
        },
        { status: 402 }
      );
    }

    // Generic server error
    console.error('Burn error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to burn' },
      { status: 500 }
    );
  }
}
