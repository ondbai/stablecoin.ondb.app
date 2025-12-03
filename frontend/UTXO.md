# UTXO-Based Stablecoin Implementation v3

## Overview

This document explains the UTXO (Unspent Transaction Output) model implementation for the VietRSD stablecoin, the security issues it addresses, and the benefits over the previous account-based model.

**Current Version: v3.1 - Multi-Chain & Multi-Wallet Support**

### Key Features
- **Chain-Agnostic Ledger**: Addresses from any blockchain ecosystem can hold and transfer tokens
- **Multi-Wallet Support**: Keplr (Cosmos), Phantom (Solana), with MetaMask (EVM) planned
- **Multi-Signature Schemes**: secp256k1 (Cosmos/EVM) and Ed25519 (Solana)
- **Cross-Chain Transfers**: Send tokens between addresses on different chains

## The Problem: Double-Spending in Account-Based Models

### What is Double-Spending?

Double-spending occurs when the same funds are spent more than once. In digital systems without proper safeguards, an attacker could potentially use the same balance for multiple transactions.

### The Original Implementation's Vulnerability

The original account-based implementation had a critical race condition vulnerability:

```typescript
// VULNERABLE CODE (original implementation)
async function transfer(from, to, amount) {
  // Step 1: Read balance (CHECK)
  const { rawBalance } = await getBalance(from);

  // ... TIME GAP - other requests can execute here ...

  // Step 2: Verify and store transaction (USE)
  if (BigInt(rawBalance) >= BigInt(amount)) {
    await storeTransaction({ from, to, amount });
  }
}
```

**Attack Scenario:**

```
Timeline:
    T0: Alice has 100 VRSD

    T1: Request A starts - reads Alice balance = 100 VRSD
    T2: Request B starts - reads Alice balance = 100 VRSD (concurrent)
    T3: Request A validates 100 >= 100, stores transfer to Bob
    T4: Request B validates 100 >= 100, stores transfer to Charlie

Result: Alice spent 200 VRSD with only 100 balance
```

This is a classic TOCTOU (Time-Of-Check-Time-Of-Use) vulnerability.

## The Solution: UTXO Model

### How UTXO Works

In the UTXO model, there are no "account balances." Instead:

1. **UTXOs are discrete coins** - Each UTXO is a specific amount that can only be spent once
2. **Transactions consume and create UTXOs** - Spending destroys old UTXOs and creates new ones
3. **Balance = Sum of unspent UTXOs** - Your balance is calculated by summing all UTXOs you own

### Data Structures

```typescript
interface UTXO {
  id: string;              // Unique: "txId:outputIndex"
  owner: string;           // Address that can spend this (any chain format)
  chainId: string;         // Chain identifier (e.g., 'mocha-4', 'solana-mainnet', 'eip155:1')
  amount: string;          // Value in smallest unit
  spent: boolean;          // Has this been consumed?
  spentInTx?: string;      // Which transaction spent it
  spentAt?: string;        // When it was spent
  createdInTx: string;     // Which transaction created it
  createdAt: string;       // When it was created
}

interface UTXOTransaction {
  id: string;              // Hash of transaction content (deterministic)
  type: 'mint' | 'burn' | 'transfer';
  inputs: UTXOTransactionInput[];   // UTXOs being consumed
  outputs: UTXOTransactionOutput[]; // New UTXOs created
  signature?: TransactionSignature; // Required for transfer/burn
  timestamp: string;
  blockHeight?: number;
}

interface TransactionSignature {
  message: string;         // JSON of signed data (inputs + outputs)
  signature: string;       // Base64-encoded signature
  publicKey: string;       // Base64-encoded public key
  signatureType?: string;  // 'secp256k1_cosmos_adr036' | 'ed25519_solana' | 'secp256k1_eip191'
}
```

### Example: Transfer Operation

**Before:**
```
UTXO_1: { id: "tx1:0", owner: "alice", amount: "100", spent: false }
```

**Alice transfers 70 to Bob:**
```
Transaction:
  inputs:  [ { utxoId: "tx1:0", owner: "alice", amount: "100" } ]
  outputs: [
    { index: 0, owner: "bob",   amount: "70" },
    { index: 1, owner: "alice", amount: "30" }
  ]
```

**After:**
```
UTXO_1: { id: "tx1:0", owner: "alice", amount: "100", spent: true }  // CONSUMED
UTXO_2: { id: "tx2:0", owner: "bob",   amount: "70",  spent: false } // NEW
UTXO_3: { id: "tx2:1", owner: "alice", amount: "30",  spent: false } // CHANGE
```

### Why Double-Spending is Impossible

```
Alice tries to spend UTXO_1 twice simultaneously:

Request A: Spend UTXO_1 -> Bob (70)
Request B: Spend UTXO_1 -> Charlie (70)

With atomic locking:
1. Request A acquires lock on UTXO_1
2. Request A checks: UTXO_1.spent == false? YES
3. Request A marks UTXO_1.spent = true
4. Request A releases lock

5. Request B acquires lock on UTXO_1
6. Request B checks: UTXO_1.spent == false? NO -> REJECT

Only ONE request can succeed.
```

## v3: Input References Model (No Nonces)

### Why Input References Instead of Nonces?

Previous implementations used nonces (random values) to prevent replay attacks. However, this required:
- Server-side nonce tracking
- Timestamp expiry checks
- Additional storage for used nonces

The **input references model** (used by Bitcoin) eliminates nonces entirely by having signatures cover specific UTXO IDs:

| Aspect | Nonce Model (v2) | Input References (v3) |
|--------|------------------|----------------------|
| **What's signed** | Intent (amount + nonce) | Specific UTXOs |
| **Replay protection** | Server tracks nonces | Intrinsic (UTXO state) |
| **Server state** | Nonce store required | None |
| **Third-party verification** | Partial | Complete |
| **Signature proves** | Intent only | Exact UTXOs spent |

### How It Works

```typescript
// v2 (Nonce Model) - DEPRECATED
sign({ type: 'transfer', from, to, amount, nonce: 'xyz123', timestamp: '...' })

// v3 (Input References) - CURRENT
sign({
  inputs: [
    { utxoId: 'abc123:0', amount: '100000000' }
  ],
  outputs: [
    { owner: 'bob', amount: '70000000' },
    { owner: 'alice', amount: '30000000' }
  ],
  chainId: 'stablecoin-utxo-v1'
})
```

### Why Replay is Impossible

```
Alice signs: "Spend UTXO abc123:0 to Bob"

Replay attempt after transaction completes:
1. Attacker captures signed message
2. Attacker replays to server
3. Server checks: UTXO abc123:0 spent? -> YES
4. Server rejects: "UTXO already spent"

The signature is bound to a UTXO that no longer exists.
```

## Data Storage (4 Tables)

### Core Tables (Source of Truth)

| Collection | Purpose |
|------------|---------|
| `stablecoin_utxos_v3` | UTXO records (id, owner, amount, spent status) |
| `stablecoin_transactions_v3` | Transaction records (inputs, outputs, signatures) |

### Materialized Views (Cached, Verifiable)

| Collection | Purpose |
|------------|---------|
| `stablecoin_balances_v3` | Per-address balance cache |
| `stablecoin_supply_v3` | Global supply metrics |

### Balance Cache Structure

```typescript
interface BalanceRecord {
  address: string;
  balance: string;
  utxoCount: number;
  lastTxId: string;
  lastUpdated: string;
  balanceHash: string;  // SHA256 of UTXO IDs (verifiable)
}
```

### Supply Metrics Structure

```typescript
interface SupplyRecord {
  id: 'current';
  totalMinted: string;
  totalBurned: string;
  circulatingSupply: string;
  totalTransactions: number;
  totalUTXOs: number;
  lastTxId: string;
  lastUpdated: string;
}
```

## Transaction ID Generation

Transaction IDs are now **hash-based** (like Bitcoin) rather than random:

```typescript
function generateTxId(tx): string {
  const content = JSON.stringify({
    type: tx.type,
    inputs: tx.inputs,
    outputs: tx.outputs,
    timestamp: tx.timestamp,
  });
  return sha256(content);  // Deterministic, verifiable
}
```

Benefits:
- **Deterministic** - Same transaction always produces same ID
- **Verifiable** - Anyone can recompute and verify
- **Tamper-evident** - Any change invalidates the ID

## Third-Party Verification

Since OnChainDB stores data on Celestia, third parties with read-only access can fully verify the ledger:

### Verification API

```
GET /api/verify                           # List verification options
GET /api/verify?type=supply               # Verify circulating supply
GET /api/verify?type=balance&address=X    # Verify balance cache
GET /api/verify?type=metrics              # Get cached supply metrics
```

### Verification Algorithm

```typescript
async function verifyLedger(onchaindb: ReadOnlyClient) {
  const txs = await onchaindb.read('stablecoin_transactions_v3');
  const utxos = await onchaindb.read('stablecoin_utxos_v3');

  const utxoState = new Map<string, { spent: boolean }>();

  for (const tx of txs.sort(byTimestamp)) {
    // 1. Verify signature matches inputs/outputs
    verifySignature(tx.inputs, tx.outputs, tx.signature);

    // 2. Verify inputs were unspent
    for (const input of tx.inputs) {
      if (utxoState.get(input.utxoId)?.spent) {
        throw new Error(`Double spend: ${input.utxoId}`);
      }
      utxoState.set(input.utxoId, { spent: true });
    }

    // 3. Verify conservation (inputs = outputs + burned)
    verifyConservation(tx);
  }

  return { valid: true };
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/balance/[address]` | GET | Get balance (from cache or computed) |
| `/api/utxos?address=X` | GET | List unspent UTXOs for address |
| `/api/mint` | POST | Create new UTXO (no signature required) |
| `/api/transfer` | POST | Transfer (requires signature) |
| `/api/burn` | POST | Burn tokens (requires signature) |
| `/api/history` | GET | List transactions |
| `/api/info` | GET | Get token info and supply metrics |
| `/api/verify` | GET | Verification endpoints for auditors |

## Signing Flow (Client-Side)

```typescript
// 1. Fetch UTXOs for sender
const utxos = await fetch(`/api/utxos?address=${sender}`);

// 2. Select UTXOs to cover amount (greedy algorithm)
const { selected, total } = selectUTXOs(utxos, amount);
const change = total - amount;

// 3. Build inputs and outputs
const inputs = selected.map(u => ({ utxoId: u.id, amount: u.amount }));
const outputs = [
  { owner: recipient, amount: transferAmount },
  { owner: sender, amount: change }  // if change > 0
];

// 4. Sign with Keplr
const signedRequest = await signTransfer(sender, recipient, inputs, transferAmount, change);

// 5. Submit to API
await fetch('/api/transfer', {
  method: 'POST',
  body: JSON.stringify({ from: sender, to: recipient, amount, signedRequest })
});
```

## Security Features

### 1. Input Validation
- Multi-chain address format validation:
  - Celestia/Cosmos: `celestia1[a-z0-9]{38}`, `cosmos1...`, `osmo1...`
  - EVM: `0x[a-fA-F0-9]{40}`
  - Solana: Base58 encoded, 32-44 characters
- Amount range validation (min/max limits)
- Precision validation (max 6 decimal places)

### 2. Transaction Limits
```typescript
const SECURITY_CONFIG = {
  MAX_TRANSACTION_AMOUNT: 1_000_000,
  MIN_TRANSACTION_AMOUNT: 0.000001,
  MAX_INPUTS_PER_TX: 100,
  MAX_OUTPUTS_PER_TX: 10,
  RATE_LIMIT_PER_MINUTE: 10,
};
```

### 3. Mint Authorization
```env
AUTHORIZED_MINTERS=celestia1...,celestia1...
ALLOW_UNRESTRICTED_MINT=false
```

### 4. Signature Verification
Multi-signature scheme support:

| Signature Type | Wallet | Curve | Address Derivation |
|----------------|--------|-------|-------------------|
| `secp256k1_cosmos_adr036` | Keplr | secp256k1 | ripemd160(sha256(pubkey)) -> bech32 |
| `ed25519_solana` | Phantom | Ed25519 | Base58(pubkey) |
| `secp256k1_eip191` | MetaMask | secp256k1 | keccak256(pubkey)[12:] -> 0x prefix |

- Address derived from public key and verified against expected sender
- Chain ID (`stablecoin-utxo-v1`) prevents cross-chain replay

### 5. Conservation Verification
```typescript
// inputs = outputs + burned
function verifyConservation(inputs, outputs, burnedAmount = 0n) {
  const totalInput = sum(inputs);
  const totalOutput = sum(outputs);

  if (totalInput !== totalOutput + burnedAmount) {
    throw new ValidationError('Conservation violation');
  }
}
```

### 6. UTXO Ownership Verification
```typescript
for (const utxo of selectedUTXOs) {
  if (utxo.owner !== sender) {
    throw new ValidationError('UTXO ownership mismatch');
  }
}
```

## HTTP Status Codes

| Status | Error Type | Example |
|--------|------------|---------|
| 400 | ValidationError | Invalid address format |
| 401 | SignatureError | Invalid/missing signature |
| 402 | Payment Required | OnChainDB payment needed |
| 403 | AuthorizationError | Unauthorized minter |
| 429 | RateLimitError | Too many requests |
| 500 | Server Error | Unexpected failures |

## Comparison with Bitcoin

| Feature | Bitcoin | VietRSD v3 |
|---------|---------|------------|
| Signature model | Signs specific inputs | Signs specific inputs |
| Transaction ID | Double SHA256 | SHA256 of content |
| Script system | Bitcoin Script | None |
| Nonces | Not needed | Not needed |
| Block confirmations | 6+ blocks | Single write |
| Consensus | Proof of Work | OnChainDB/Celestia |
| UTXO set storage | Prunable | Append-only DB |
| Third-party verification | Full nodes | Read-only access |

## Environment Configuration

```env
# OnChainDB
ONCHAINDB_ENDPOINT=https://api.onchaindb.io
ONCHAINDB_APP_ID=your-app-id
ONCHAINDB_APP_KEY=your-app-key

# Security
AUTHORIZED_MINTERS=celestia1...
ALLOW_UNRESTRICTED_MINT=false
REQUIRE_SIGNATURES=true
CHAIN_ID=stablecoin-utxo-v1

# Token
STABLECOIN_NAME=VietRSD
STABLECOIN_SYMBOL=VRSD
STABLECOIN_DECIMALS=6
```

## Multi-Chain Architecture

### Supported Chains

| Chain ID | Ecosystem | Address Format | Wallet |
|----------|-----------|----------------|--------|
| `mocha-4` | Celestia Testnet | `celestia1...` | Keplr |
| `cosmos` | Cosmos Hub | `cosmos1...` | Keplr |
| `osmosis` | Osmosis | `osmo1...` | Keplr |
| `solana-mainnet` | Solana | Base58 (case-sensitive) | Phantom |
| `eip155:1` | Ethereum | `0x...` | MetaMask (planned) |
| `eip155:137` | Polygon | `0x...` | MetaMask (planned) |

### Address Normalization

Different blockchains have different case sensitivity rules:

```typescript
function normalizeAddress(address: string): string {
  // EVM addresses are case-insensitive
  if (address.startsWith('0x')) {
    return address.toLowerCase();
  }
  // Cosmos bech32 addresses are case-insensitive
  if (address.startsWith('celestia') || address.startsWith('cosmos') || address.startsWith('osmo')) {
    return address.toLowerCase();
  }
  // Solana base58 addresses are CASE-SENSITIVE - preserve original
  return address;
}
```

### Chain Detection from Address

The system automatically detects the target chain from the address format:

```typescript
function detectChainFromAddress(address: string): string {
  if (address.startsWith('celestia')) return 'mocha-4';
  if (address.startsWith('cosmos')) return 'cosmos';
  if (address.startsWith('osmo')) return 'osmosis';
  if (address.startsWith('0x')) return 'eip155:1';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return 'solana-mainnet';
  return 'unknown';
}
```

### Cross-Chain Transfer Example

Alice (Celestia) sends 50 VRSD to Bob (Solana):

```
Transaction:
  inputs: [
    { utxoId: "tx1:0", amount: "100000000" }  // Alice's UTXO on Celestia
  ]
  outputs: [
    { owner: "BBfZ5eFss...", chainId: "solana-mainnet", amount: "50000000" },  // To Bob
    { owner: "celestia1...", chainId: "mocha-4", amount: "50000000" }          // Change to Alice
  ]
  signature: {
    signatureType: "secp256k1_cosmos_adr036",  // Alice signs with Keplr
    ...
  }
```

## Wallet Adapter Interface

```typescript
interface WalletAdapter {
  readonly walletType: WalletType;
  readonly name: string;

  isInstalled(): boolean;
  connect(): Promise<WalletState>;
  disconnect(): Promise<void>;
  getBalance(address: string): Promise<string>;

  signTransaction(
    inputs: SignableInput[],
    outputs: SignableOutput[],
    signerAddress: string
  ): Promise<SignedTransactionRequest>;

  sendPayment(toAddress: string, amount: number): Promise<string>;
}
```

### Available Adapters

| Adapter | Status | Ecosystem |
|---------|--------|-----------|
| `KeplrAdapter` | Implemented | Cosmos (Celestia, Osmosis) |
| `PhantomAdapter` | Implemented | Solana |
| `MetaMaskAdapter` | Planned | EVM (Ethereum, Polygon, etc.) |
| `CoinbaseAdapter` | Planned | Multi-chain |

## Remaining Considerations

1. **Distributed locking** - Current in-memory locks work for single-server; use Redis/Redlock for multi-server
2. **UTXO consolidation** - Many small UTXOs can be consolidated into fewer larger ones
3. **Pagination** - Large UTXO sets should be paginated for performance
4. **MetaMask integration** - EIP-191 signature verification for EVM wallets
5. **Chain-specific fees** - Different chains may have different OnChainDB fee structures

## Conclusion

The v3.1 implementation with input references and multi-chain support provides:

1. **Trustless verification** - Third parties can fully audit with read-only OnChainDB access
2. **No auxiliary state** - No nonce tracking, expiry checks, or cleanup needed
3. **Stronger signatures** - Prove exact UTXO consumption, not just intent
4. **Better caching** - Materialized balance/supply views with verification
5. **Bitcoin-like security** - Signatures bound to specific UTXOs eliminate replay attacks intrinsically
6. **Chain-agnostic** - Any blockchain address can hold and transfer tokens
7. **Multi-wallet** - Support for Keplr (Cosmos), Phantom (Solana), and more wallets planned
8. **Cross-chain transfers** - Seamlessly transfer tokens between different blockchain ecosystems
