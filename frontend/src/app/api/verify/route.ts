import { NextRequest, NextResponse } from 'next/server';
import {
  verifyBalanceCache,
  verifySupplyMetrics,
  getSupplyMetrics,
  getCachedBalance,
  COLLECTIONS,
} from '@/lib/stablecoin-utxo';

// GET /api/verify - Verify cache integrity (for third-party auditors)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const address = searchParams.get('address');

    // Verify supply metrics
    if (type === 'supply') {
      const result = await verifySupplyMetrics();
      return NextResponse.json({
        type: 'supply',
        ...result,
        collections: COLLECTIONS,
      });
    }

    // Verify balance cache for an address
    if (type === 'balance') {
      if (!address) {
        return NextResponse.json(
          { error: 'Address parameter required for balance verification' },
          { status: 400 }
        );
      }

      const result = await verifyBalanceCache(address);
      return NextResponse.json({
        type: 'balance',
        address,
        ...result,
      });
    }

    // Get supply metrics (no verification, just cached data)
    if (type === 'metrics') {
      const metrics = await getSupplyMetrics();
      return NextResponse.json({
        type: 'metrics',
        data: metrics,
        collections: COLLECTIONS,
      });
    }

    // Get cached balance for an address (no verification)
    if (type === 'cached-balance') {
      if (!address) {
        return NextResponse.json(
          { error: 'Address parameter required' },
          { status: 400 }
        );
      }

      const cached = await getCachedBalance(address);
      return NextResponse.json({
        type: 'cached-balance',
        address,
        data: cached,
      });
    }

    // Default: return available verification options
    return NextResponse.json({
      message: 'Verification API for third-party auditors',
      endpoints: {
        supply: '/api/verify?type=supply - Verify circulating supply matches UTXO sum',
        balance: '/api/verify?type=balance&address=<addr> - Verify balance cache for address',
        metrics: '/api/verify?type=metrics - Get cached supply metrics',
        cachedBalance: '/api/verify?type=cached-balance&address=<addr> - Get cached balance',
      },
      collections: COLLECTIONS,
      description: 'All cached data can be independently verified by summing UTXOs from the core tables',
    });
  } catch (error) {
    console.error('Verification error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Verification failed' },
      { status: 500 }
    );
  }
}
