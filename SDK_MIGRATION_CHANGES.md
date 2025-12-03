# SDK Migration Changes

This document describes the changes made to the stablecoin codebase to align with the local OnChainDB SDK (`../../onchaindb/sdk-ts`).

## Package.json Update

Changed the SDK dependency from a temporary path to the correct local SDK path:

```json
// Before
"@onchaindb/sdk": "file:../../../../../../private/tmp/onchaindb-sdk"

// After
"@onchaindb/sdk": "file:../../onchaindb/sdk-ts"
```

## client.ts Changes

### 1. Import Updates

Added `StoreResponse` type import for proper typing:

```typescript
// Before
import { createClient, OnChainDBClient as SDKClient } from '@onchaindb/sdk';

// After
import { createClient, OnChainDBClient as SDKClient, StoreResponse } from '@onchaindb/sdk';
```

### 2. store() Function

Updated to use the SDK's three-parameter signature and properly handle the async ticket-based response:

```typescript
// Before
export async function store<T extends Record<string, any>>(
  collection: string,
  data: T[]
): Promise<StoreResult> {
  const client = getClient();
  const result = await client.store({
    collection,
    data,
  });
  return {
    block_height: result.block_height || 0,
  };
}

// After
export async function store<T extends Record<string, any>>(
  collection: string,
  data: T[],
  waitForConfirmation: boolean = true
): Promise<StoreResult> {
  const client = getClient();
  const result: StoreResponse = await client.store(
    {
      collection,
      data,
    },
    undefined,  // paymentCallback (optional)
    waitForConfirmation
  );
  return {
    block_height: result.block_height || 0,
    ticket_id: (result as any).ticket_id,
  };
}
```

Key changes:
- Added `waitForConfirmation` parameter (default: `true`) to control async behavior
- SDK now returns ticket-based responses for async operations
- The `store` method signature is: `store(request, paymentCallback?, waitForConfirmation?)`

### 3. findOne() Function

Updated to use the SDK's built-in `findUnique` method which handles sorting by metadata (returns latest record):

```typescript
// Before
export async function findOne<T extends Record<string, any>>(
  collection: string,
  filters: Record<string, any>
): Promise<T | null> {
  const results = await query<T>(collection, filters, 1);
  return results[0] || null;
}

// After
export async function findOne<T extends Record<string, any>>(
  collection: string,
  filters: Record<string, any>
): Promise<T | null> {
  const client = getClient();
  const result = await client.findUnique<T>(collection, filters);
  return result;
}
```

### 4. New Functions Added

Added new helper functions that leverage SDK capabilities:

```typescript
// findMany - uses SDK's findMany with pagination support
export async function findMany<T extends Record<string, any>>(
  collection: string,
  filters: Record<string, any> = {},
  options: { limit?: number; offset?: number } = {}
): Promise<T[]> {
  const client = getClient();
  return client.findMany<T>(collection, filters, options);
}

// countDocuments - uses SDK's server-side aggregation
export async function countDocuments(
  collection: string,
  filters: Record<string, any> = {}
): Promise<number> {
  const client = getClient();
  return client.countDocuments(collection, filters);
}
```

## SDK API Reference

The local SDK provides the following key interfaces:

### OnChainDBConfig
```typescript
interface OnChainDBConfig {
  endpoint: string;
  apiKey?: string;      // Deprecated: use appKey
  appKey?: string;      // App API key for write operations
  userKey?: string;     // User API key for Auto-Pay
  appId?: string;       // Application ID for automatic root building
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
}
```

### StoreRequest
```typescript
interface StoreRequest {
  root?: string;           // Format: "app::collection"
  collection?: string;     // Collection name (combined with appId)
  data: Record<string, any>[];
  payment_tx_hash?: string;
  // ... other payment options
}
```

### StoreResponse
```typescript
interface StoreResponse {
  id: string;
  namespace: string;
  block_height: number;
  transaction_hash: string;
  confirmed: boolean;
  celestia_height: number;
  ticket_id?: string;     // For async operations
}
```

### Key Client Methods

| Method | Description |
|--------|-------------|
| `store(request, paymentCallback?, waitForConfirmation?)` | Store data on-chain |
| `query(request)` | Query with filters |
| `findUnique(collection, where)` | Find single document (latest by metadata) |
| `findMany(collection, where, options)` | Find multiple documents |
| `countDocuments(collection, where)` | Count matching documents |
| `database(appId)` | Get DatabaseManager for index/collection management |

### DatabaseManager Methods

| Method | Description |
|--------|-------------|
| `createIndex(indexDefinition)` | Create an index on a collection |
| `listIndexes(collection?)` | List indexes |
| `createCollection(name, config)` | Create a collection |
| `listCollections()` | List all collections |

## Notes

1. The SDK now uses a ticket-based async flow for store operations. When `waitForConfirmation=true`, it polls the task status until completion.

2. The `findUnique` method returns the latest record by metadata (`updatedAt` or `createdAt`) when multiple matches exist.

3. Index creation uses the `DatabaseManager` accessed via `client.database(appId)`.

4. The SDK supports x402 payment protocol for both read and write operations via payment callbacks.

---

# Multi-Chain Payment Support (Hyperlane Integration)

The stablecoin app now supports multi-chain payments via Hyperlane, allowing users to pay for OnChainDB operations from EVM chains (Ethereum, Arbitrum, Base) and Solana, in addition to native Celestia payments.

## New Files Created

### 1. `frontend/src/lib/hyperlane-payment.ts`

Utility module for Hyperlane cross-chain payments:

- `PaymentChain` type - Supported payment chains
- `PaymentOption` interface - x402 payment option structure
- `MultiChainPaymentQuote` interface - Enhanced quote with multi-chain options
- `PaymentResult` interface - Cross-chain payment result
- Helper functions for chain detection and formatting

### 2. `frontend/src/lib/wallets/metamask-adapter.ts`

New MetaMask wallet adapter with full EVM support:

```typescript
class MetaMaskAdapter implements WalletAdapter {
  // Core wallet methods
  connect(): Promise<WalletState>
  disconnect(): Promise<void>
  getBalance(address: string): Promise<string>
  signTransaction(inputs, outputs, signerAddress): Promise<SignedTransactionRequest>

  // Payment methods
  sendPayment(toAddress: string, amount: number): Promise<string>
  sendHyperlanePayment(paymentOption: PaymentOption, amount: number): Promise<PaymentResult>

  // Chain support
  getSupportedPaymentChains(): string[]
}
```

Features:
- EIP-191 message signing for stablecoin transactions
- Native ETH payments
- Hyperlane Warp Route cross-chain transfers
- Automatic chain switching via `wallet_switchEthereumChain`
- Support for multiple EVM chains (Ethereum, Arbitrum, Base, etc.)

## Updated Files

### 1. `frontend/src/lib/wallet-interface.ts`

Added new interfaces for multi-chain payments:

```typescript
// Payment options from x402 quote
interface PaymentOption {
  scheme: 'exact' | 'celestia-native' | 'hyperlane-warp';
  network: string;
  asset: string;
  payTo: string;
  maxAmountRequired: string;
  extra?: {
    quoteId?: string;
    chainType?: 'cosmos' | 'evm' | 'svm';
    paymentMethod?: 'native' | 'hyperlane-warp';
    tokenSymbol?: string;
    tokenDecimals?: number;
    bridge?: {
      protocol: string;
      originDomain: number;
      destinationDomain: number;
    };
  };
}

// Payment result for multi-chain payments
interface PaymentResult {
  txHash: string;
  network: string;
  scheme?: 'exact' | 'celestia-native' | 'hyperlane-warp';
  originChain?: string;
  token?: string;
  messageId?: string;
}
```

Updated `WalletAdapter` interface with new methods:
- `sendHyperlanePayment?(paymentOption, amount)` - Optional cross-chain payment
- `getSupportedPaymentChains()` - Returns list of supported chains

### 2. `frontend/src/lib/wallets/keplr-adapter.ts`

Added `getSupportedPaymentChains()` method:
```typescript
getSupportedPaymentChains(): string[] {
  return ['celestia', 'mocha-4'];
}
```

### 3. `frontend/src/lib/wallets/phantom-adapter.ts`

Enhanced with EVM support via Phantom's Ethereum provider:

- Added `getPhantomEthereum()` helper for EVM access
- Updated `sendPayment()` to try EVM payment if available
- Added `sendHyperlanePayment()` for cross-chain transfers
- Added `getSupportedPaymentChains()` returning both Solana and EVM chains

### 4. `frontend/src/lib/wallets/index.ts`

Updated wallet manager:

- Added MetaMask adapter to available wallets
- Updated `WalletInfo` interface with `supportedChains` field
- Enhanced `WalletManager` class with:
  - `sendHyperlanePayment(paymentOption, amount)` - Cross-chain payment
  - `supportsHyperlanePayments()` - Check if current wallet supports Hyperlane
  - `getSupportedPaymentChains()` - Get chains supported by current wallet

### 5. `frontend/src/app/page.tsx`

Updated payment flow to support multi-chain:

```typescript
// New imports
import { PaymentOption, PaymentResult } from '@/lib/wallets';

// Updated PaymentQuote interface
interface PaymentQuote {
  quote_id: string;
  total_cost_tia: number;
  broker_address: string;
  description?: string;
  options?: PaymentOption[];  // Multi-chain payment options from x402
}

// Updated handlePaymentAndRetry function
// - Checks for multi-chain options in quote
// - Finds compatible payment option for connected wallet
// - Uses Hyperlane payment if available and supported
// - Falls back to native Celestia payment

// New helper function
findCompatiblePaymentOption(options, supportedChains): PaymentOption | null
```

## Payment Flow

### Native Celestia Payment (Keplr)
1. User connects Keplr wallet
2. Operation triggers 402 Payment Required
3. Quote returned with `broker_address` and `total_cost_tia`
4. App calls `walletManager.sendPayment()` for native TIA transfer
5. Operation retried with payment tx hash

### Hyperlane Cross-Chain Payment (MetaMask/Phantom EVM)
1. User connects MetaMask or Phantom (EVM mode)
2. Operation triggers 402 Payment Required
3. Quote returned with `options[]` containing Hyperlane warp routes
4. App finds compatible option for connected wallet's chains
5. App calls `walletManager.sendHyperlanePayment(option)`:
   - Switches to correct EVM chain if needed
   - Executes Hyperlane Warp Route `transferRemote()` or ERC20 transfer
   - Returns `PaymentResult` with tx hash and metadata
6. Operation retried with payment result

## Supported Chains

| Wallet | Native Payments | Hyperlane Payments |
|--------|-----------------|-------------------|
| Keplr | Celestia (TIA) | - |
| MetaMask | ETH (native) | Ethereum, Arbitrum, Base, Polygon |
| Phantom | - | Arbitrum, Base (via EVM provider) |

## Configuration

The Hyperlane warp route addresses are configured in `hyperlane-payment.ts`:

```typescript
const HYPERLANE_WARP_ROUTES: Record<string, {
  contractAddress: string;
  tokenAddress: string;
  chainId: number;
  domain: number;
  tokenSymbol: string;
  tokenDecimals: number;
  rpcUrl: string;
}> = {
  'arbitrum-sepolia': { ... },
  'base-sepolia': { ... },
  'ethereum-sepolia': { ... },
};
```

These addresses need to be updated with the actual deployed Hyperlane warp route contracts for TIA tokens on each chain.
