import { NextRequest, NextResponse } from 'next/server';
import { transfer, ValidationError, RateLimitError, SignatureError, SignedTransactionRequest } from '@/lib/stablecoin-utxo';

export async function POST(request: NextRequest) {
  console.log('[/api/transfer] POST request received');

  try {
    const body = await request.json();
    const { from, to, amount, paymentTxHash, signedRequest } = body;

    console.log('[/api/transfer] Request body:', {
      from,
      to,
      amount,
      paymentTxHash,
      hasSignedRequest: !!signedRequest,
    });

    // Build signed request if provided (input references model)
    let signedTransactionRequest: SignedTransactionRequest | undefined;
    if (signedRequest) {
      console.log('[/api/transfer] Processing signed request:', {
        inputsCount: signedRequest.inputs?.length,
        outputsCount: signedRequest.outputs?.length,
        signatureType: signedRequest.signature?.signatureType,
        hasMessage: !!signedRequest.signature?.message,
        hasSignature: !!signedRequest.signature?.signature,
        hasPublicKey: !!signedRequest.signature?.publicKey,
      });

      signedTransactionRequest = {
        inputs: signedRequest.inputs,
        outputs: signedRequest.outputs,
        signature: {
          message: signedRequest.signature.message,
          signature: signedRequest.signature.signature,
          publicKey: signedRequest.signature.publicKey,
          signatureType: signedRequest.signature.signatureType,
        },
      };
    }

    console.log('[/api/transfer] Calling transfer function...');
    const transaction = await transfer(from, to, amount, paymentTxHash, signedTransactionRequest);
    console.log('[/api/transfer] Transfer successful:', {
      id: transaction.id,
      blockHeight: transaction.blockHeight,
    });
    return NextResponse.json(transaction);
  } catch (error: unknown) {
    // Handle signature errors (401 Unauthorized)
    if (error instanceof SignatureError) {
      console.error('[/api/transfer] Signature error:', {
        message: error.message,
        code: error.code,
      });
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 401 }
      );
    }

    // Handle validation errors (400 Bad Request)
    if (error instanceof ValidationError) {
      console.error('[/api/transfer] Validation error:', {
        message: error.message,
        code: error.code,
      });
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }

    // Handle rate limit errors (429 Too Many Requests)
    if (error instanceof RateLimitError) {
      console.error('[/api/transfer] Rate limit error:', error.message);
      return NextResponse.json(
        { error: error.message, code: 'RATE_LIMITED' },
        { status: 429 }
      );
    }

    // Check if this is a payment required error with quote details
    const err = error as { code?: string; details?: unknown };
    if (err?.code === 'PAYMENT_REQUIRED' && err?.details) {
      console.log('[/api/transfer] Payment required:', err.details);
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
    console.error('[/api/transfer] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to transfer' },
      { status: 500 }
    );
  }
}
