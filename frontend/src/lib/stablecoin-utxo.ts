import { createClient, OnDBClient, PaymentRequiredError, X402Quote, X402PaymentRequirement } from '@onchaindb/sdk';
import { sha256, ripemd160 } from '@cosmjs/crypto';
import { toHex } from '@cosmjs/encoding';

// ============================================================================
// UTXO-Based Stablecoin Implementation v3
// ============================================================================
// This implementation uses the UTXO model with INPUT REFERENCES for signatures.
// This eliminates the need for nonces - signatures are bound to specific UTXOs.
// Third parties can fully verify the ledger with read-only access.
// ============================================================================

// ============================================================================
// Security Configuration
// ============================================================================

// Build authorized minters list from both AUTHORIZED_MINTERS and ADMIN_ADDRESS
const buildAuthorizedMinters = (): string[] => {
  const minters: string[] = [];

  // Add AUTHORIZED_MINTERS
  const authorizedMinters = (process.env.AUTHORIZED_MINTERS || '').split(',').filter(Boolean);
  minters.push(...authorizedMinters);

  // Add ADMIN_ADDRESS if set and not already included
  const adminAddress = process.env.ADMIN_ADDRESS?.trim().toLowerCase();
  if (adminAddress && !minters.some(m => m.trim().toLowerCase() === adminAddress)) {
    minters.push(adminAddress);
  }

  return minters;
};

const SECURITY_CONFIG = {
  // Maximum single transaction amount (in display units, e.g., 1,000,000 VRSD)
  MAX_TRANSACTION_AMOUNT: 1_000_000,
  // Minimum transaction amount (in display units)
  MIN_TRANSACTION_AMOUNT: 0.000001,
  // Maximum number of UTXOs that can be consumed in a single transaction
  MAX_INPUTS_PER_TX: 100,
  // Maximum number of outputs per transaction
  MAX_OUTPUTS_PER_TX: 10,
  // Rate limiting: max transactions per address per minute
  RATE_LIMIT_PER_MINUTE: 10,
  // Authorized minters (addresses that can mint new tokens) - includes ADMIN_ADDRESS
  AUTHORIZED_MINTERS: buildAuthorizedMinters(),
  // Allow unrestricted minting - defaults to false for security
  ALLOW_UNRESTRICTED_MINT: process.env.ALLOW_UNRESTRICTED_MINT === 'true',
  // Require cryptographic signatures for transfers and burns
  REQUIRE_SIGNATURES: process.env.REQUIRE_SIGNATURES !== 'false',
};

// Rate limiting store (in production, use Redis or similar)
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

// ============================================================================
// Error Types
// ============================================================================

export class ValidationError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class SignatureError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'SignatureError';
  }
}

// ============================================================================
// Data Types
// ============================================================================

export interface UTXO {
  id: string;              // Unique identifier: txId:outputIndex
  owner: string;           // Address that can spend this UTXO
  chainId: string;         // Chain identifier (e.g., 'mocha-4', 'solana-mainnet', 'eip155:1')
  amount: string;          // Value in smallest unit (6 decimals)
  spent: boolean;          // Has this UTXO been consumed?
  spentInTx?: string;      // Transaction that consumed this UTXO
  spentAt?: string;        // When it was spent
  createdInTx: string;     // Transaction that created this UTXO
  createdAt: string;       // When it was created
}

export interface UTXOTransactionInput {
  utxoId: string;          // Reference to UTXO being spent
  owner: string;           // Must match UTXO owner
  amount: string;          // Amount of this UTXO (for signature verification)
}

export interface UTXOTransactionOutput {
  index: number;           // Position in outputs array
  owner: string;           // Recipient address
  chainId: string;         // Chain identifier for the recipient
  amount: string;          // Value
}

export interface TransactionSignature {
  message: string;         // JSON of signed data (inputs + outputs)
  signature: string;       // Base64 signature
  publicKey: string;       // Base64 public key
  signatureType?: string;  // Optional signature type (e.g., 'secp256k1_cosmos_adr036', 'ed25519_solana')
}

export interface UTXOTransaction {
  id: string;              // Hash of transaction content
  type: 'mint' | 'burn' | 'transfer';
  inputs: UTXOTransactionInput[];
  outputs: UTXOTransactionOutput[];
  signature?: TransactionSignature;  // Required for transfer/burn
  timestamp: string;
  blockHeight?: number;
}

// Balance cache record
export interface BalanceRecord {
  address: string;
  balance: string;
  utxoCount: number;
  lastTxId: string;
  lastUpdated: string;
  balanceHash: string;     // Hash of UTXO IDs for verification
}

// Supply metrics record
export interface SupplyRecord {
  id: string;              // 'current'
  totalMinted: string;
  totalBurned: string;
  circulatingSupply: string;
  totalTransactions: number;
  totalUTXOs: number;
  lastTxId: string;
  lastUpdated: string;
}

// What the client signs (inputs + outputs, no nonce needed)
export interface SignableTransaction {
  inputs: { utxoId: string; amount: string }[];
  outputs: { owner: string; chainId: string; amount: string }[];
  chainId: string;
}

// Request format for signed transactions
export interface SignedTransactionRequest {
  inputs: { utxoId: string; amount: string }[];
  outputs: { owner: string; chainId: string; amount: string }[];
  signature: TransactionSignature;
}

// ============================================================================
// Configuration
// ============================================================================

const ENDPOINT = process.env.ONCHAINDB_ENDPOINT || 'https://api.onchaindb.io';
const APP_ID = process.env.ONCHAINDB_APP_ID || '';
const APP_KEY = process.env.ONCHAINDB_APP_KEY || '';
const USER_KEY = process.env.ONCHAINDB_USER_KEY || '';

const STABLECOIN_NAME = process.env.STABLECOIN_NAME || 'VietRSD';
const STABLECOIN_SYMBOL = process.env.STABLECOIN_SYMBOL || 'VRSD';
const STABLECOIN_DECIMALS = parseInt(process.env.STABLECOIN_DECIMALS || '6', 10);
const CHAIN_ID = process.env.CHAIN_ID || 'stablecoin-utxo-v1';

// v3 collections with input references model
const COLLECTIONS = {
  utxos: 'stablecoin_utxos_v3',
  transactions: 'stablecoin_transactions_v3',
  balances: 'stablecoin_balances_v3',
  supply: 'stablecoin_supply_v3',
};

// In-memory lock for preventing concurrent spends of the same UTXO
const spendingLocks = new Map<string, Promise<void>>();

let sdkClient: OnDBClient | null = null;

function getClient(): OnDBClient {
  if (!sdkClient) {
    sdkClient = createClient({
      endpoint: ENDPOINT,
      appId: APP_ID,
      appKey: APP_KEY,
      userKey: USER_KEY || undefined,
    });
  }
  return sdkClient;
}

// ============================================================================
// Transaction ID Generation (Hash-based, like Bitcoin)
// ============================================================================

function generateTxId(tx: Omit<UTXOTransaction, 'id' | 'blockHeight'>): string {
  // Create deterministic hash of transaction content
  const content = JSON.stringify({
    type: tx.type,
    inputs: tx.inputs.map(i => ({ utxoId: i.utxoId, owner: i.owner, amount: i.amount })),
    outputs: tx.outputs.map(o => ({ index: o.index, owner: o.owner, amount: o.amount })),
    timestamp: tx.timestamp,
  });

  const hash = sha256(new TextEncoder().encode(content));
  return toHex(hash);
}

// ============================================================================
// Validation Functions
// ============================================================================

// Validate different address formats for multi-wallet support
function isValidCelestiaAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  const celestiaRegex = /^celestia1[a-z0-9]{38}$/;
  return celestiaRegex.test(address);
}

function isValidSolanaAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  // Solana addresses are base58 encoded, 32-44 characters
  const solanaRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return solanaRegex.test(address);
}

function isValidEvmAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  // EVM addresses are 0x followed by 40 hex characters
  const evmRegex = /^0x[a-fA-F0-9]{40}$/;
  return evmRegex.test(address);
}

function isValidAddress(address: string): boolean {
  return isValidCelestiaAddress(address) ||
         isValidSolanaAddress(address) ||
         isValidEvmAddress(address);
}

// Normalize address based on chain type
// - EVM addresses (0x...) are case-insensitive, lowercase them
// - Solana addresses (base58) are case-sensitive, preserve case
// - Cosmos addresses (bech32) are case-insensitive, lowercase them
function normalizeAddress(address: string): string {
  if (address.startsWith('0x')) {
    return address.toLowerCase();
  }
  if (address.startsWith('celestia') || address.startsWith('cosmos') || address.startsWith('osmo')) {
    return address.toLowerCase();
  }
  // Solana base58 address - case sensitive, preserve original
  return address;
}

function validateAddress(address: unknown, fieldName: string): string {
  if (typeof address !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`, 'INVALID_TYPE');
  }
  const sanitized = address.trim();
  if (!sanitized) {
    throw new ValidationError(`${fieldName} is required`, 'REQUIRED_FIELD');
  }
  if (!isValidAddress(sanitized)) {
    throw new ValidationError(
      `${fieldName} must be a valid address (celestia1..., 0x..., or Solana base58)`,
      'INVALID_ADDRESS_FORMAT'
    );
  }
  // Normalize based on chain type (preserve Solana case sensitivity)
  return normalizeAddress(sanitized);
}

// Supported chain IDs (CAIP-2 format recommended for EVM chains)
const SUPPORTED_CHAIN_IDS = [
  'mocha-4',           // Celestia testnet
  'celestia',          // Celestia mainnet
  'solana-mainnet',    // Solana mainnet
  'solana-devnet',     // Solana devnet
  'eip155:1',          // Ethereum mainnet
  'eip155:137',        // Polygon mainnet
  'eip155:42161',      // Arbitrum One
  'eip155:10',         // Optimism
  'eip155:8453',       // Base
  'eip155:11155111',   // Sepolia testnet
];

function validateChainId(chainId: unknown): string {
  if (typeof chainId !== 'string') {
    throw new ValidationError('Chain ID must be a string', 'INVALID_TYPE');
  }
  const sanitized = chainId.trim().toLowerCase();
  if (!sanitized) {
    throw new ValidationError('Chain ID is required', 'REQUIRED_FIELD');
  }
  // Allow any chain ID format but warn if not in known list
  // This allows for future chain additions without code changes
  return sanitized;
}

function validateAmount(amount: unknown): number {
  if (typeof amount !== 'number') {
    throw new ValidationError('Amount must be a number', 'INVALID_TYPE');
  }
  if (!Number.isFinite(amount)) {
    throw new ValidationError('Amount must be a finite number', 'INVALID_AMOUNT');
  }
  if (amount <= 0) {
    throw new ValidationError('Amount must be positive', 'INVALID_AMOUNT');
  }
  if (amount < SECURITY_CONFIG.MIN_TRANSACTION_AMOUNT) {
    throw new ValidationError(
      `Amount must be at least ${SECURITY_CONFIG.MIN_TRANSACTION_AMOUNT}`,
      'AMOUNT_TOO_SMALL'
    );
  }
  if (amount > SECURITY_CONFIG.MAX_TRANSACTION_AMOUNT) {
    throw new ValidationError(
      `Amount cannot exceed ${SECURITY_CONFIG.MAX_TRANSACTION_AMOUNT}`,
      'AMOUNT_TOO_LARGE'
    );
  }
  const decimalPart = amount.toString().split('.')[1] || '';
  if (decimalPart.length > 6) {
    throw new ValidationError('Amount cannot have more than 6 decimal places', 'INVALID_PRECISION');
  }
  return amount;
}

function checkRateLimit(address: string): void {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const entry = rateLimitStore.get(address);

  if (!entry || (now - entry.windowStart) > windowMs) {
    rateLimitStore.set(address, { count: 1, windowStart: now });
    return;
  }

  if (entry.count >= SECURITY_CONFIG.RATE_LIMIT_PER_MINUTE) {
    throw new RateLimitError(
      `Rate limit exceeded. Maximum ${SECURITY_CONFIG.RATE_LIMIT_PER_MINUTE} transactions per minute.`
    );
  }
  entry.count++;
}

function checkMintAuthorization(minterAddress?: string): void {
  if (SECURITY_CONFIG.ALLOW_UNRESTRICTED_MINT) {
    return;
  }
  if (SECURITY_CONFIG.AUTHORIZED_MINTERS.length === 0) {
    console.warn('WARNING: No AUTHORIZED_MINTERS configured. Minting is unrestricted.');
    return;
  }
  if (!minterAddress) {
    throw new AuthorizationError('Minter address required for authorization');
  }
  const normalizedMinter = minterAddress.trim().toLowerCase();
  const isAuthorized = SECURITY_CONFIG.AUTHORIZED_MINTERS.some(
    addr => addr.trim().toLowerCase() === normalizedMinter
  );
  if (!isAuthorized) {
    throw new AuthorizationError('Address is not authorized to mint tokens');
  }
}

function validateUTXOSelection(utxos: UTXO[]): void {
  if (utxos.length > SECURITY_CONFIG.MAX_INPUTS_PER_TX) {
    throw new ValidationError(
      `Transaction cannot consume more than ${SECURITY_CONFIG.MAX_INPUTS_PER_TX} UTXOs`,
      'TOO_MANY_INPUTS'
    );
  }
}

function validateOutputs(outputs: { owner: string; chainId: string; amount: string }[]): void {
  if (outputs.length > SECURITY_CONFIG.MAX_OUTPUTS_PER_TX) {
    throw new ValidationError(
      `Transaction cannot have more than ${SECURITY_CONFIG.MAX_OUTPUTS_PER_TX} outputs`,
      'TOO_MANY_OUTPUTS'
    );
  }
  for (const output of outputs) {
    const amount = BigInt(output.amount);
    if (amount <= 0n) {
      throw new ValidationError('Output amounts must be positive', 'INVALID_OUTPUT_AMOUNT');
    }
    if (!output.chainId) {
      throw new ValidationError('Output chainId is required', 'MISSING_CHAIN_ID');
    }
  }
}

function verifyConservation(
  inputs: { amount: string }[],
  outputs: { amount: string }[],
  burnedAmount: bigint = 0n
): void {
  const totalInput = inputs.reduce((sum, i) => sum + BigInt(i.amount), 0n);
  const totalOutput = outputs.reduce((sum, o) => sum + BigInt(o.amount), 0n);

  if (totalInput !== totalOutput + burnedAmount) {
    throw new ValidationError(
      `Transaction doesn't balance: inputs(${totalInput}) != outputs(${totalOutput}) + burned(${burnedAmount})`,
      'CONSERVATION_VIOLATION'
    );
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function toBigIntAmount(amount: number, decimals: number): string {
  const multiplier = Math.pow(10, decimals);
  return Math.floor(amount * multiplier).toString();
}

function fromBigIntAmount(amount: string, decimals: number): number {
  const multiplier = Math.pow(10, decimals);
  return parseInt(amount, 10) / multiplier;
}

// ============================================================================
// Storage Operations
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function storeRecords(
  collection: string,
  data: Record<string, any>[],
  paymentTxHash?: string
): Promise<{ block_height: number }> {
  const client = getClient();

  const paymentCallback = paymentTxHash
    ? async () => ({
        txHash: paymentTxHash,
        network: 'mocha-4',
        sender: '',
        chainType: 'cosmos' as const,
        paymentMethod: 'native' as const,
      })
    : undefined;

  try {
    const result = await client.store(
      { collection, data },
      paymentCallback
    );
    return { block_height: result.block_height || 0 };
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string; details?: unknown };
    if (err?.code === 'PAYMENT_REQUIRED' || err?.message?.includes('Payment required')) {
      const paymentError = new Error('Payment required') as Error & { code: string; details: unknown };
      paymentError.code = 'PAYMENT_REQUIRED';
      paymentError.details = err.details || err;
      throw paymentError;
    }
    throw error;
  }
}

// ============================================================================
// UTXO Query Operations
// ============================================================================

async function getAllUTXOs(): Promise<UTXO[]> {
  const client = getClient();
  try {
    const result = await client.queryBuilder()
      .collection(COLLECTIONS.utxos)
      .selectAll()
      .limit(10000)
      .execute();
    return (result.records || []) as UTXO[];
  } catch (error) {
    console.error('Error fetching UTXOs:', error);
    return [];
  }
}

async function getUTXOState(utxoId: string): Promise<UTXO | null> {
  const allUtxos = await getAllUTXOs();
  const utxoRecords = allUtxos
    .filter(u => u.id === utxoId)
    .sort((a, b) => {
      const aTime = new Date(a.spentAt || a.createdAt).getTime();
      const bTime = new Date(b.spentAt || b.createdAt).getTime();
      return bTime - aTime;
    });
  return utxoRecords[0] || null;
}

export async function getUnspentUTXOs(address: string): Promise<UTXO[]> {
  const allUtxos = await getAllUTXOs();
  const utxoMap = new Map<string, UTXO>();

  for (const utxo of allUtxos) {
    const existing = utxoMap.get(utxo.id);
    if (!existing) {
      utxoMap.set(utxo.id, utxo);
    } else {
      const existingTime = new Date(existing.spentAt || existing.createdAt).getTime();
      const newTime = new Date(utxo.spentAt || utxo.createdAt).getTime();
      if (newTime > existingTime) {
        utxoMap.set(utxo.id, utxo);
      }
    }
  }

  return Array.from(utxoMap.values())
    .filter(u => u.owner === address && !u.spent);
}

// ============================================================================
// UTXO Selection (Coin Selection Algorithm)
// ============================================================================

function selectUTXOs(utxos: UTXO[], targetAmount: bigint): { selected: UTXO[]; total: bigint } {
  const sorted = [...utxos].sort((a, b) =>
    Number(BigInt(b.amount) - BigInt(a.amount))
  );

  const selected: UTXO[] = [];
  let total = 0n;

  for (const utxo of sorted) {
    if (total >= targetAmount) break;
    selected.push(utxo);
    total += BigInt(utxo.amount);
  }

  if (total < targetAmount) {
    throw new ValidationError(
      `Insufficient funds: have ${total.toString()}, need ${targetAmount.toString()}`,
      'INSUFFICIENT_FUNDS'
    );
  }

  return { selected, total };
}

// ============================================================================
// Locking Mechanism
// ============================================================================

async function acquireUTXOLocks(utxoIds: string[]): Promise<() => void> {
  const releases: (() => void)[] = [];

  for (const utxoId of utxoIds) {
    while (spendingLocks.has(utxoId)) {
      await spendingLocks.get(utxoId);
    }

    let release: () => void;
    const lockPromise = new Promise<void>(resolve => {
      release = resolve;
    });
    spendingLocks.set(utxoId, lockPromise);
    releases.push(() => {
      spendingLocks.delete(utxoId);
      release!();
    });
  }

  return () => releases.forEach(r => r());
}

async function verifyUTXOsUnspent(utxoIds: string[]): Promise<UTXO[]> {
  const utxos: UTXO[] = [];
  for (const utxoId of utxoIds) {
    const utxo = await getUTXOState(utxoId);
    if (!utxo) {
      throw new ValidationError(`UTXO ${utxoId} not found`, 'UTXO_NOT_FOUND');
    }
    if (utxo.spent) {
      throw new ValidationError(
        `UTXO ${utxoId} has already been spent in transaction ${utxo.spentInTx}`,
        'UTXO_ALREADY_SPENT'
      );
    }
    utxos.push(utxo);
  }
  return utxos;
}

// ============================================================================
// Signature Verification (Multi-Wallet Support)
// ============================================================================
// Supports multiple signature types:
// - secp256k1_cosmos_adr036: Keplr and Cosmos wallets (ADR-036 format)
// - secp256k1_eip191: Metamask and EVM wallets (future)
// - ed25519_solana: Phantom and Solana wallets (future)
// ============================================================================

import { Secp256k1, Secp256k1Signature, Ed25519 } from '@cosmjs/crypto';
import { fromBase64, toBase64, toBech32, toUtf8 } from '@cosmjs/encoding';
import bs58 from 'bs58';
import { serializeSignDoc } from '@cosmjs/amino';
import { verifyMessage } from 'viem';

// Signature types supported
type SignatureType =
  | 'secp256k1_cosmos_adr036'
  | 'secp256k1_eip191'
  | 'ed25519_solana'
  | 'secp256k1_raw';

// Extended signature interface with type
interface TransactionSignatureWithType extends TransactionSignature {
  signatureType?: SignatureType;
}

// Cosmos SDK address derivation: ripemd160(sha256(pubkey))
function pubkeyToCosmosAddress(pubkeyBase64: string, prefix: string = 'celestia'): string {
  const pubkeyBytes = fromBase64(pubkeyBase64);
  const sha256Hash = sha256(pubkeyBytes);
  const addressBytes = ripemd160(sha256Hash);
  return toBech32(prefix, addressBytes);
}

// Create the expected message format
function createSignableMessage(data: SignableTransaction): string {
  const orderedData = {
    chainId: data.chainId,
    inputs: data.inputs.map(i => ({ amount: i.amount, utxoId: i.utxoId })),
    outputs: data.outputs.map(o => ({ amount: o.amount, chainId: o.chainId, owner: o.owner })),
  };
  return JSON.stringify(orderedData);
}

// Create ADR-036 sign doc for verification (matches Keplr's signArbitrary format)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeAdr036SignDoc(signer: string, data: string): any {
  return {
    chain_id: '',
    account_number: '0',
    sequence: '0',
    fee: {
      gas: '0',
      amount: [],
    },
    msgs: [
      {
        type: 'sign/MsgSignData',
        value: {
          signer: signer,
          data: toBase64(toUtf8(data)),
        },
      },
    ],
    memo: '',
  };
}

async function verifyTransactionSignature(
  signableData: SignableTransaction,
  signature: TransactionSignature,
  expectedSender: string
): Promise<void> {
  console.log('[verifyTransactionSignature] Starting verification:', {
    signatureType: signature.signatureType,
    expectedSender,
    messagePreview: signature.message?.substring(0, 100) + '...',
    signatureLength: signature.signature?.length,
    publicKeyLength: signature.publicKey?.length,
  });

  // 1. Verify message matches expected format
  const expectedMessage = createSignableMessage(signableData);
  console.log('[verifyTransactionSignature] Expected message:', expectedMessage.substring(0, 100) + '...');
  console.log('[verifyTransactionSignature] Received message:', signature.message?.substring(0, 100) + '...');
  console.log('[verifyTransactionSignature] Messages match:', signature.message === expectedMessage);

  if (signature.message !== expectedMessage) {
    console.error('[verifyTransactionSignature] Message mismatch!');
    console.error('[verifyTransactionSignature] Expected:', expectedMessage);
    console.error('[verifyTransactionSignature] Got:', signature.message);
    throw new SignatureError(
      'Signed message does not match transaction data',
      'MESSAGE_MISMATCH'
    );
  }

  // 2. Verify chain ID
  if (signableData.chainId !== CHAIN_ID) {
    console.error('[verifyTransactionSignature] Chain ID mismatch:', {
      expected: CHAIN_ID,
      got: signableData.chainId,
    });
    throw new SignatureError(
      `Invalid chain ID: expected ${CHAIN_ID}, got ${signableData.chainId}`,
      'INVALID_CHAIN_ID'
    );
  }

  // 3. Get signature type (default to ADR-036 for backwards compatibility)
  const signatureType = signature.signatureType || 'secp256k1_cosmos_adr036';
  console.log('[verifyTransactionSignature] Using signature type:', signatureType);

  // 4. Decode signature and public key
  let signatureBytes: Uint8Array;
  let pubkeyBytes: Uint8Array;
  try {
    signatureBytes = fromBase64(signature.signature);
    pubkeyBytes = fromBase64(signature.publicKey);
    console.log('[verifyTransactionSignature] Decoded signature bytes:', signatureBytes.length);
    console.log('[verifyTransactionSignature] Decoded pubkey bytes:', pubkeyBytes.length);
  } catch (e) {
    console.error('[verifyTransactionSignature] Base64 decode error:', e);
    throw new SignatureError('Invalid base64 encoding', 'INVALID_ENCODING');
  }

  // 5. Verify based on signature type
  console.log('[verifyTransactionSignature] Calling verification function for:', signatureType);
  switch (signatureType) {
    case 'secp256k1_cosmos_adr036':
      await verifyCosmosAdr036Signature(
        signature.message,
        signatureBytes,
        pubkeyBytes,
        expectedSender
      );
      break;

    case 'secp256k1_raw':
      await verifyRawSecp256k1Signature(
        signature.message,
        signatureBytes,
        pubkeyBytes,
        expectedSender
      );
      break;

    case 'secp256k1_eip191':
      await verifyEip191Signature(
        signature.message,
        signatureBytes,
        expectedSender
      );
      break;

    case 'ed25519_solana':
      await verifyEd25519SolanaSignature(
        signature.message,
        signatureBytes,
        pubkeyBytes,
        expectedSender
      );
      break;

    default:
      console.error('[verifyTransactionSignature] Unknown signature type:', signatureType);
      throw new SignatureError(`Unknown signature type: ${signatureType}`, 'UNKNOWN_TYPE');
  }

  console.log('[verifyTransactionSignature] Verification completed successfully');
}

async function verifyCosmosAdr036Signature(
  message: string,
  signatureBytes: Uint8Array,
  pubkeyBytes: Uint8Array,
  expectedSender: string
): Promise<void> {
  // 1. Derive address from public key
  let derivedAddress: string;
  try {
    derivedAddress = pubkeyToCosmosAddress(toBase64(pubkeyBytes));
  } catch {
    throw new SignatureError('Invalid public key format', 'INVALID_PUBLIC_KEY');
  }

  // 2. Verify address matches sender
  if (derivedAddress.toLowerCase() !== expectedSender.toLowerCase()) {
    throw new SignatureError(
      `Signer address mismatch: expected ${expectedSender}, got ${derivedAddress}`,
      'ADDRESS_MISMATCH'
    );
  }

  // 3. Create ADR-036 sign doc and hash it using proper cosmjs serialization
  const signDoc = makeAdr036SignDoc(expectedSender, message);
  const signDocBytes = serializeSignDoc(signDoc);
  const messageHash = sha256(signDocBytes);

  // 4. Verify signature
  let isValid: boolean;
  try {
    isValid = await Secp256k1.verifySignature(
      Secp256k1Signature.fromFixedLength(signatureBytes),
      messageHash,
      pubkeyBytes
    );
  } catch (e) {
    throw new SignatureError(`Signature verification failed: ${e}`, 'VERIFICATION_FAILED');
  }

  if (!isValid) {
    throw new SignatureError('Invalid signature', 'INVALID_SIGNATURE');
  }
}

async function verifyRawSecp256k1Signature(
  message: string,
  signatureBytes: Uint8Array,
  pubkeyBytes: Uint8Array,
  expectedSender: string
): Promise<void> {
  // 1. Derive address from public key
  let derivedAddress: string;
  try {
    derivedAddress = pubkeyToCosmosAddress(toBase64(pubkeyBytes));
  } catch {
    throw new SignatureError('Invalid public key format', 'INVALID_PUBLIC_KEY');
  }

  // 2. Verify address matches sender
  if (derivedAddress.toLowerCase() !== expectedSender.toLowerCase()) {
    throw new SignatureError(
      `Signer address mismatch: expected ${expectedSender}, got ${derivedAddress}`,
      'ADDRESS_MISMATCH'
    );
  }

  // 3. Hash the raw message
  const messageBytes = new TextEncoder().encode(message);
  const messageHash = sha256(messageBytes);

  // 4. Verify signature
  let isValid: boolean;
  try {
    isValid = await Secp256k1.verifySignature(
      Secp256k1Signature.fromFixedLength(signatureBytes),
      messageHash,
      pubkeyBytes
    );
  } catch {
    throw new SignatureError('Signature verification failed', 'VERIFICATION_FAILED');
  }

  if (!isValid) {
    throw new SignatureError('Invalid signature', 'INVALID_SIGNATURE');
  }
}

// Verify EIP-191 signature (MetaMask/EVM wallets)
// Uses viem's verifyMessage which handles the Ethereum signed message prefix
async function verifyEip191Signature(
  message: string,
  signatureBytes: Uint8Array,
  expectedSender: string
): Promise<void> {
  console.log('[verifyEip191Signature] Starting EIP-191 verification:', {
    messageLength: message.length,
    signatureBytesLength: signatureBytes.length,
    expectedSender,
  });

  // 1. Verify expected sender is a valid EVM address
  if (!expectedSender.startsWith('0x') || expectedSender.length !== 42) {
    console.error('[verifyEip191Signature] Invalid EVM address format:', expectedSender);
    throw new SignatureError(
      `Invalid EVM address format: ${expectedSender}`,
      'INVALID_ADDRESS_FORMAT'
    );
  }

  // 2. Convert signature bytes to hex string with 0x prefix
  const signatureHex = ('0x' + Buffer.from(signatureBytes).toString('hex')) as `0x${string}`;
  console.log('[verifyEip191Signature] Signature hex:', signatureHex.substring(0, 20) + '...');

  // 3. Use viem's verifyMessage which handles EIP-191 prefix internally
  // EIP-191 prefixes the message with "\x19Ethereum Signed Message:\n" + length
  let isValid: boolean;
  try {
    console.log('[verifyEip191Signature] Calling viem verifyMessage...');
    isValid = await verifyMessage({
      address: expectedSender as `0x${string}`,
      message,
      signature: signatureHex,
    });
    console.log('[verifyEip191Signature] viem verifyMessage result:', isValid);
  } catch (e) {
    console.error('[verifyEip191Signature] viem verifyMessage threw error:', e);
    throw new SignatureError(
      `EIP-191 signature verification failed: ${e}`,
      'VERIFICATION_FAILED'
    );
  }

  if (!isValid) {
    console.error('[verifyEip191Signature] Signature invalid');
    throw new SignatureError('Invalid EIP-191 signature', 'INVALID_SIGNATURE');
  }

  console.log('[verifyEip191Signature] Verification successful');
}

// Convert Ed25519 public key bytes to Solana address (base58)
function pubkeyToSolanaAddress(pubkeyBytes: Uint8Array): string {
  // Solana addresses ARE the base58-encoded 32-byte public key
  return bs58.encode(pubkeyBytes);
}

async function verifyEd25519SolanaSignature(
  message: string,
  signatureBytes: Uint8Array,
  pubkeyBytes: Uint8Array,
  expectedSender: string
): Promise<void> {
  // 1. Derive Solana address from public key
  let derivedAddress: string;
  try {
    derivedAddress = pubkeyToSolanaAddress(pubkeyBytes);
  } catch {
    throw new SignatureError('Invalid Ed25519 public key format', 'INVALID_PUBLIC_KEY');
  }

  // 2. Verify address matches sender (Solana addresses are case-sensitive)
  if (derivedAddress !== expectedSender) {
    throw new SignatureError(
      `Signer address mismatch: expected ${expectedSender}, got ${derivedAddress}`,
      'ADDRESS_MISMATCH'
    );
  }

  // 3. Verify the Ed25519 signature
  // Phantom signs the raw message bytes (not hashed)
  const messageBytes = new TextEncoder().encode(message);

  let isValid: boolean;
  try {
    isValid = await Ed25519.verifySignature(signatureBytes, messageBytes, pubkeyBytes);
  } catch {
    throw new SignatureError('Signature verification failed', 'VERIFICATION_FAILED');
  }

  if (!isValid) {
    throw new SignatureError('Invalid signature', 'INVALID_SIGNATURE');
  }
}

// ============================================================================
// Materialized Views (Balance & Supply Caches)
// ============================================================================

async function updateBalanceCache(
  address: string,
  txId: string,
  paymentTxHash?: string
): Promise<void> {
  const utxos = await getUnspentUTXOs(address);
  const balance = utxos.reduce((sum, u) => sum + BigInt(u.amount), 0n);

  // Create verifiable hash of contributing UTXOs
  const utxoIds = utxos.map(u => u.id).sort();
  const balanceHash = toHex(sha256(new TextEncoder().encode(utxoIds.join(','))));

  const record: BalanceRecord = {
    address,
    balance: balance.toString(),
    utxoCount: utxos.length,
    lastTxId: txId,
    lastUpdated: new Date().toISOString(),
    balanceHash,
  };

  await storeRecords(COLLECTIONS.balances, [record], paymentTxHash);
}

async function updateSupplyMetrics(
  tx: UTXOTransaction,
  paymentTxHash?: string
): Promise<void> {
  // Get current supply record or create new one
  const client = getClient();
  let currentSupply: SupplyRecord;

  try {
    const result = await client.queryBuilder()
      .collection(COLLECTIONS.supply)
      .selectAll()
      .limit(100)
      .execute();

    const records = (result.records || []) as SupplyRecord[];
    // Get the most recent supply record
    const sorted = records.sort((a, b) =>
      new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
    );
    currentSupply = sorted[0] || {
      id: 'current',
      totalMinted: '0',
      totalBurned: '0',
      circulatingSupply: '0',
      totalTransactions: 0,
      totalUTXOs: 0,
      lastTxId: '',
      lastUpdated: new Date().toISOString(),
    };
  } catch {
    currentSupply = {
      id: 'current',
      totalMinted: '0',
      totalBurned: '0',
      circulatingSupply: '0',
      totalTransactions: 0,
      totalUTXOs: 0,
      lastTxId: '',
      lastUpdated: new Date().toISOString(),
    };
  }

  // Calculate changes
  let mintedDelta = 0n;
  let burnedDelta = 0n;
  let utxoDelta = 0;

  if (tx.type === 'mint') {
    mintedDelta = tx.outputs.reduce((sum, o) => sum + BigInt(o.amount), 0n);
    utxoDelta = tx.outputs.length;
  } else if (tx.type === 'burn') {
    const inputTotal = tx.inputs.reduce((sum, i) => sum + BigInt(i.amount), 0n);
    const outputTotal = tx.outputs.reduce((sum, o) => sum + BigInt(o.amount), 0n);
    burnedDelta = inputTotal - outputTotal;
    utxoDelta = tx.outputs.length - tx.inputs.length;
  } else if (tx.type === 'transfer') {
    utxoDelta = tx.outputs.length - tx.inputs.length;
  }

  const newSupply: SupplyRecord = {
    id: 'current',
    totalMinted: (BigInt(currentSupply.totalMinted) + mintedDelta).toString(),
    totalBurned: (BigInt(currentSupply.totalBurned) + burnedDelta).toString(),
    circulatingSupply: (
      BigInt(currentSupply.totalMinted) + mintedDelta -
      BigInt(currentSupply.totalBurned) - burnedDelta
    ).toString(),
    totalTransactions: currentSupply.totalTransactions + 1,
    totalUTXOs: currentSupply.totalUTXOs + utxoDelta,
    lastTxId: tx.id,
    lastUpdated: new Date().toISOString(),
  };

  await storeRecords(COLLECTIONS.supply, [newSupply], paymentTxHash);
}

async function updateMaterializedViews(
  tx: UTXOTransaction,
  paymentTxHash?: string
): Promise<void> {
  // Collect affected addresses
  const affectedAddresses = new Set<string>();
  for (const input of tx.inputs) {
    affectedAddresses.add(input.owner);
  }
  for (const output of tx.outputs) {
    affectedAddresses.add(output.owner);
  }

  // Update balance caches
  for (const address of affectedAddresses) {
    await updateBalanceCache(address, tx.id, paymentTxHash);
  }

  // Update supply metrics
  await updateSupplyMetrics(tx, paymentTxHash);
}

// ============================================================================
// Core Transaction Operations
// ============================================================================

// Get balance (from cache if available, otherwise calculate)
export async function getBalance(address: string): Promise<{
  balance: number;
  rawBalance: string;
  symbol: string;
  utxoCount: number;
}> {
  // Try to get from cache first
  const client = getClient();
  try {
    const result = await client.queryBuilder()
      .collection(COLLECTIONS.balances)
      .selectAll()
      .limit(1000)
      .execute();

    const records = (result.records || []) as BalanceRecord[];
    const addressRecords = records
      .filter(r => r.address === address)
      .sort((a, b) =>
        new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
      );

    if (addressRecords.length > 0) {
      const cached = addressRecords[0];
      return {
        balance: fromBigIntAmount(cached.balance, STABLECOIN_DECIMALS),
        rawBalance: cached.balance,
        symbol: STABLECOIN_SYMBOL,
        utxoCount: cached.utxoCount,
      };
    }
  } catch {
    // Cache miss, calculate from UTXOs
  }

  // Fallback: calculate from UTXOs
  const utxos = await getUnspentUTXOs(address);
  const rawBalance = utxos.reduce((sum, u) => sum + BigInt(u.amount), 0n).toString();

  return {
    balance: fromBigIntAmount(rawBalance, STABLECOIN_DECIMALS),
    rawBalance,
    symbol: STABLECOIN_SYMBOL,
    utxoCount: utxos.length,
  };
}

// MINT: Create new UTXOs (no inputs required)
export async function mint(
  toAddress: string,
  amount: number,
  chainId: string,
  paymentTxHash?: string,
  minterAddress?: string
): Promise<UTXOTransaction> {
  const validatedAddress = validateAddress(toAddress, 'Recipient address');
  const validatedAmount = validateAmount(amount);
  const validatedChainId = validateChainId(chainId);

  checkMintAuthorization(minterAddress);
  checkRateLimit(validatedAddress);

  const rawAmount = toBigIntAmount(validatedAmount, STABLECOIN_DECIMALS);
  const now = new Date().toISOString();

  // Build transaction (without ID first)
  const txWithoutId = {
    type: 'mint' as const,
    inputs: [] as UTXOTransactionInput[],
    outputs: [{ index: 0, owner: validatedAddress, chainId: validatedChainId, amount: rawAmount }],
    timestamp: now,
  };

  // Generate hash-based transaction ID
  const txId = generateTxId(txWithoutId);

  const transaction: UTXOTransaction = {
    id: txId,
    ...txWithoutId,
  };

  validateOutputs(transaction.outputs.map(o => ({ owner: o.owner, chainId: o.chainId, amount: o.amount })));

  // Create the new UTXO
  const newUtxo: UTXO = {
    id: `${txId}:0`,
    owner: validatedAddress,
    chainId: validatedChainId,
    amount: rawAmount,
    spent: false,
    createdInTx: txId,
    createdAt: now,
  };

  // Store transaction and UTXO
  const result = await storeRecords(COLLECTIONS.transactions, [transaction], paymentTxHash);
  await storeRecords(COLLECTIONS.utxos, [newUtxo], paymentTxHash);

  // Update materialized views
  await updateMaterializedViews(transaction, paymentTxHash);

  transaction.blockHeight = result.block_height;
  return transaction;
}

// TRANSFER: Consume UTXOs and create new ones (with input references signature)
export async function transfer(
  fromAddress: string,
  toAddress: string,
  amount: number,
  paymentTxHash?: string,
  signedRequest?: SignedTransactionRequest
): Promise<UTXOTransaction> {
  console.log('[transfer] Starting transfer:', {
    fromAddress,
    toAddress,
    amount,
    paymentTxHash,
    hasSignedRequest: !!signedRequest,
  });

  const validatedFrom = validateAddress(fromAddress, 'Sender address');
  const validatedTo = validateAddress(toAddress, 'Recipient address');
  const validatedAmount = validateAmount(amount);

  console.log('[transfer] Validated addresses and amount:', {
    validatedFrom,
    validatedTo,
    validatedAmount,
  });

  if (validatedFrom === validatedTo) {
    throw new ValidationError('Cannot transfer to the same address', 'SELF_TRANSFER');
  }

  checkRateLimit(validatedFrom);

  const transferAmount = BigInt(toBigIntAmount(validatedAmount, STABLECOIN_DECIMALS));
  const now = new Date().toISOString();

  console.log('[transfer] Transfer amount (bigint):', transferAmount.toString());

  let selectedUTXOs: UTXO[];
  let inputTotal: bigint;
  let transactionSignature: TransactionSignature | undefined;

  if (SECURITY_CONFIG.REQUIRE_SIGNATURES) {
    console.log('[transfer] Signatures required, checking signedRequest...');
    if (!signedRequest) {
      console.error('[transfer] No signed request provided');
      throw new SignatureError('Transaction signature required', 'SIGNATURE_REQUIRED');
    }

    console.log('[transfer] SignedRequest details:', {
      inputsCount: signedRequest.inputs?.length,
      outputsCount: signedRequest.outputs?.length,
      signatureType: signedRequest.signature?.signatureType,
      publicKey: signedRequest.signature?.publicKey,
      messageLength: signedRequest.signature?.message?.length,
      signatureLength: signedRequest.signature?.signature?.length,
    });

    // Use the inputs specified in the signed request
    const utxoIds = signedRequest.inputs.map(i => i.utxoId);
    console.log('[transfer] UTXO IDs from request:', utxoIds);

    const releaseLocks = await acquireUTXOLocks(utxoIds);

    try {
      // Verify UTXOs exist and are unspent
      selectedUTXOs = await verifyUTXOsUnspent(utxoIds);
      console.log('[transfer] Verified UTXOs:', selectedUTXOs.map(u => ({
        id: u.id,
        amount: u.amount,
        owner: u.owner,
      })));

      // Verify amounts match
      for (const input of signedRequest.inputs) {
        const utxo = selectedUTXOs.find(u => u.id === input.utxoId);
        if (!utxo || utxo.amount !== input.amount) {
          console.error('[transfer] UTXO amount mismatch:', {
            utxoId: input.utxoId,
            expectedAmount: input.amount,
            actualAmount: utxo?.amount,
          });
          throw new ValidationError(
            `UTXO amount mismatch for ${input.utxoId}`,
            'UTXO_AMOUNT_MISMATCH'
          );
        }
        if (utxo.owner !== validatedFrom) {
          console.error('[transfer] UTXO ownership mismatch:', {
            utxoId: input.utxoId,
            utxoOwner: utxo.owner,
            expectedOwner: validatedFrom,
          });
          throw new ValidationError(
            `UTXO ${input.utxoId} does not belong to sender`,
            'UTXO_OWNERSHIP_MISMATCH'
          );
        }
      }

      inputTotal = selectedUTXOs.reduce((sum, u) => sum + BigInt(u.amount), 0n);
      console.log('[transfer] Input total:', inputTotal.toString());

      if (inputTotal < transferAmount) {
        console.error('[transfer] Insufficient funds:', {
          inputTotal: inputTotal.toString(),
          transferAmount: transferAmount.toString(),
        });
        throw new ValidationError(
          `Insufficient funds in selected UTXOs: have ${inputTotal}, need ${transferAmount}`,
          'INSUFFICIENT_FUNDS'
        );
      }

      // Verify signature
      const signableData: SignableTransaction = {
        inputs: signedRequest.inputs,
        outputs: signedRequest.outputs,
        chainId: CHAIN_ID,
      };

      console.log('[transfer] Verifying signature with signableData:', {
        inputsCount: signableData.inputs.length,
        outputsCount: signableData.outputs.length,
        chainId: signableData.chainId,
      });

      await verifyTransactionSignature(signableData, signedRequest.signature, validatedFrom);
      console.log('[transfer] Signature verified successfully');
      transactionSignature = signedRequest.signature;

    } catch (error) {
      releaseLocks();
      throw error;
    }

    // Continue with locks held...
    const change = inputTotal - transferAmount;

    // Build transaction outputs using chainId from signedRequest
    const outputs: UTXOTransactionOutput[] = signedRequest.outputs.map((o, idx) => ({
      index: idx,
      owner: o.owner,
      chainId: o.chainId,
      amount: o.amount,
    }));

    // Build transaction
    const txWithoutId = {
      type: 'transfer' as const,
      inputs: selectedUTXOs.map(u => ({ utxoId: u.id, owner: u.owner, amount: u.amount })),
      outputs,
      signature: transactionSignature,
      timestamp: now,
    };

    const txId = generateTxId(txWithoutId);
    const transaction: UTXOTransaction = { id: txId, ...txWithoutId };

    validateOutputs(transaction.outputs.map(o => ({ owner: o.owner, chainId: o.chainId, amount: o.amount })));
    verifyConservation(
      selectedUTXOs.map(u => ({ amount: u.amount })),
      transaction.outputs,
      0n
    );

    // Mark spent and create new UTXOs
    const spentUTXOs: UTXO[] = selectedUTXOs.map(u => ({
      ...u,
      spent: true,
      spentInTx: txId,
      spentAt: now,
    }));

    const newUTXOs: UTXO[] = transaction.outputs.map(out => ({
      id: `${txId}:${out.index}`,
      owner: out.owner,
      chainId: out.chainId,
      amount: out.amount,
      spent: false,
      createdInTx: txId,
      createdAt: now,
    }));

    try {
      const result = await storeRecords(COLLECTIONS.transactions, [transaction], paymentTxHash);
      await storeRecords(COLLECTIONS.utxos, [...spentUTXOs, ...newUTXOs], paymentTxHash);
      await updateMaterializedViews(transaction, paymentTxHash);

      transaction.blockHeight = result.block_height;
      return transaction;
    } finally {
      releaseLocks();
    }
  } else {
    // No signature required (development mode)
    const availableUTXOs = await getUnspentUTXOs(validatedFrom);

    if (availableUTXOs.length === 0) {
      throw new ValidationError(`No UTXOs found for address ${validatedFrom}`, 'NO_UTXOS');
    }

    const selection = selectUTXOs(availableUTXOs, transferAmount);
    selectedUTXOs = selection.selected;
    inputTotal = selection.total;

    validateUTXOSelection(selectedUTXOs);

    // Get chainId from first selected UTXO (dev mode uses same chain)
    const senderChainId = selectedUTXOs[0].chainId || 'mocha-4';

    const utxoIds = selectedUTXOs.map(u => u.id);
    const releaseLocks = await acquireUTXOLocks(utxoIds);

    try {
      await verifyUTXOsUnspent(utxoIds);

      const change = inputTotal - transferAmount;

      const txOutputs: UTXOTransactionOutput[] = [
        { index: 0, owner: validatedTo, chainId: senderChainId, amount: transferAmount.toString() }
      ];

      if (change > 0n) {
        txOutputs.push({
          index: 1,
          owner: validatedFrom,
          chainId: senderChainId,
          amount: change.toString()
        });
      }

      const txWithoutId = {
        type: 'transfer' as const,
        inputs: selectedUTXOs.map(u => ({ utxoId: u.id, owner: u.owner, amount: u.amount })),
        outputs: txOutputs,
        timestamp: now,
      };

      const txId = generateTxId(txWithoutId);
      const transaction: UTXOTransaction = { id: txId, ...txWithoutId };

      validateOutputs(transaction.outputs.map(o => ({ owner: o.owner, chainId: o.chainId, amount: o.amount })));
      verifyConservation(
        selectedUTXOs.map(u => ({ amount: u.amount })),
        transaction.outputs,
        0n
      );

      const spentUTXOs: UTXO[] = selectedUTXOs.map(u => ({
        ...u,
        spent: true,
        spentInTx: txId,
        spentAt: now,
      }));

      const newUTXOs: UTXO[] = transaction.outputs.map(out => ({
        id: `${txId}:${out.index}`,
        owner: out.owner,
        chainId: out.chainId,
        amount: out.amount,
        spent: false,
        createdInTx: txId,
        createdAt: now,
      }));

      const result = await storeRecords(COLLECTIONS.transactions, [transaction], paymentTxHash);
      await storeRecords(COLLECTIONS.utxos, [...spentUTXOs, ...newUTXOs], paymentTxHash);
      await updateMaterializedViews(transaction, paymentTxHash);

      transaction.blockHeight = result.block_height;
      return transaction;
    } finally {
      releaseLocks();
    }
  }
}

// BURN: Consume UTXOs without creating outputs (except change)
export async function burn(
  fromAddress: string,
  amount: number,
  paymentTxHash?: string,
  signedRequest?: SignedTransactionRequest
): Promise<UTXOTransaction> {
  const validatedFrom = validateAddress(fromAddress, 'Burner address');
  const validatedAmount = validateAmount(amount);

  checkRateLimit(validatedFrom);

  const burnAmount = BigInt(toBigIntAmount(validatedAmount, STABLECOIN_DECIMALS));
  const now = new Date().toISOString();

  let selectedUTXOs: UTXO[];
  let inputTotal: bigint;
  let transactionSignature: TransactionSignature | undefined;

  if (SECURITY_CONFIG.REQUIRE_SIGNATURES) {
    if (!signedRequest) {
      throw new SignatureError('Transaction signature required', 'SIGNATURE_REQUIRED');
    }

    const utxoIds = signedRequest.inputs.map(i => i.utxoId);
    const releaseLocks = await acquireUTXOLocks(utxoIds);

    try {
      selectedUTXOs = await verifyUTXOsUnspent(utxoIds);

      for (const input of signedRequest.inputs) {
        const utxo = selectedUTXOs.find(u => u.id === input.utxoId);
        if (!utxo || utxo.amount !== input.amount) {
          throw new ValidationError(
            `UTXO amount mismatch for ${input.utxoId}`,
            'UTXO_AMOUNT_MISMATCH'
          );
        }
        if (utxo.owner !== validatedFrom) {
          throw new ValidationError(
            `UTXO ${input.utxoId} does not belong to burner`,
            'UTXO_OWNERSHIP_MISMATCH'
          );
        }
      }

      inputTotal = selectedUTXOs.reduce((sum, u) => sum + BigInt(u.amount), 0n);

      if (inputTotal < burnAmount) {
        throw new ValidationError(
          `Insufficient funds in selected UTXOs: have ${inputTotal}, need ${burnAmount}`,
          'INSUFFICIENT_FUNDS'
        );
      }

      const signableData: SignableTransaction = {
        inputs: signedRequest.inputs,
        outputs: signedRequest.outputs,
        chainId: CHAIN_ID,
      };

      await verifyTransactionSignature(signableData, signedRequest.signature, validatedFrom);
      transactionSignature = signedRequest.signature;

    } catch (error) {
      releaseLocks();
      throw error;
    }

    const change = inputTotal - burnAmount;

    // Build outputs from signedRequest (change output has chainId)
    const txOutputs: UTXOTransactionOutput[] = signedRequest.outputs.map((o, idx) => ({
      index: idx,
      owner: o.owner,
      chainId: o.chainId,
      amount: o.amount,
    }));

    const txWithoutId = {
      type: 'burn' as const,
      inputs: selectedUTXOs.map(u => ({ utxoId: u.id, owner: u.owner, amount: u.amount })),
      outputs: txOutputs,
      signature: transactionSignature,
      timestamp: now,
    };

    const txId = generateTxId(txWithoutId);
    const transaction: UTXOTransaction = { id: txId, ...txWithoutId };

    if (transaction.outputs.length > 0) {
      validateOutputs(transaction.outputs.map(o => ({ owner: o.owner, chainId: o.chainId, amount: o.amount })));
    }
    verifyConservation(
      selectedUTXOs.map(u => ({ amount: u.amount })),
      transaction.outputs,
      burnAmount
    );

    const spentUTXOs: UTXO[] = selectedUTXOs.map(u => ({
      ...u,
      spent: true,
      spentInTx: txId,
      spentAt: now,
    }));

    const newUTXOs: UTXO[] = transaction.outputs.map(out => ({
      id: `${txId}:${out.index}`,
      owner: out.owner,
      chainId: out.chainId,
      amount: out.amount,
      spent: false,
      createdInTx: txId,
      createdAt: now,
    }));

    try {
      const result = await storeRecords(COLLECTIONS.transactions, [transaction], paymentTxHash);
      if (spentUTXOs.length > 0 || newUTXOs.length > 0) {
        await storeRecords(COLLECTIONS.utxos, [...spentUTXOs, ...newUTXOs], paymentTxHash);
      }
      await updateMaterializedViews(transaction, paymentTxHash);

      transaction.blockHeight = result.block_height;
      return transaction;
    } finally {
      releaseLocks();
    }
  } else {
    // No signature required (development mode)
    const availableUTXOs = await getUnspentUTXOs(validatedFrom);

    if (availableUTXOs.length === 0) {
      throw new ValidationError(`No UTXOs found for address ${validatedFrom}`, 'NO_UTXOS');
    }

    const selection = selectUTXOs(availableUTXOs, burnAmount);
    selectedUTXOs = selection.selected;
    inputTotal = selection.total;

    validateUTXOSelection(selectedUTXOs);

    // Get chainId from first selected UTXO (dev mode uses same chain)
    const senderChainId = selectedUTXOs[0].chainId || 'mocha-4';

    const utxoIds = selectedUTXOs.map(u => u.id);
    const releaseLocks = await acquireUTXOLocks(utxoIds);

    try {
      await verifyUTXOsUnspent(utxoIds);

      const change = inputTotal - burnAmount;

      const txOutputs: UTXOTransactionOutput[] = [];

      if (change > 0n) {
        txOutputs.push({
          index: 0,
          owner: validatedFrom,
          chainId: senderChainId,
          amount: change.toString()
        });
      }

      const txWithoutId = {
        type: 'burn' as const,
        inputs: selectedUTXOs.map(u => ({ utxoId: u.id, owner: u.owner, amount: u.amount })),
        outputs: txOutputs,
        timestamp: now,
      };

      const txId = generateTxId(txWithoutId);
      const transaction: UTXOTransaction = { id: txId, ...txWithoutId };

      if (transaction.outputs.length > 0) {
        validateOutputs(transaction.outputs.map(o => ({ owner: o.owner, chainId: o.chainId, amount: o.amount })));
      }
      verifyConservation(
        selectedUTXOs.map(u => ({ amount: u.amount })),
        transaction.outputs,
        burnAmount
      );

      const spentUTXOs: UTXO[] = selectedUTXOs.map(u => ({
        ...u,
        spent: true,
        spentInTx: txId,
        spentAt: now,
      }));

      const newUTXOs: UTXO[] = transaction.outputs.map(out => ({
        id: `${txId}:${out.index}`,
        owner: out.owner,
        chainId: out.chainId,
        amount: out.amount,
        spent: false,
        createdInTx: txId,
        createdAt: now,
      }));

      const result = await storeRecords(COLLECTIONS.transactions, [transaction], paymentTxHash);
      if (spentUTXOs.length > 0 || newUTXOs.length > 0) {
        await storeRecords(COLLECTIONS.utxos, [...spentUTXOs, ...newUTXOs], paymentTxHash);
      }
      await updateMaterializedViews(transaction, paymentTxHash);

      transaction.blockHeight = result.block_height;
      return transaction;
    } finally {
      releaseLocks();
    }
  }
}

// ============================================================================
// Query Operations
// ============================================================================

export async function getHistory(address?: string): Promise<UTXOTransaction[]> {
  const client = getClient();
  try {
    const result = await client.queryBuilder()
      .collection(COLLECTIONS.transactions)
      .selectAll()
      .limit(100)
      .execute();

    let transactions = (result.records || []) as UTXOTransaction[];

    if (address) {
      transactions = transactions.filter(tx =>
        tx.inputs.some(i => i.owner === address) ||
        tx.outputs.some(o => o.owner === address)
      );
    }

    transactions.sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime();
      const bTime = new Date(b.timestamp).getTime();
      return bTime - aTime;
    });

    return transactions;
  } catch (error) {
    // Re-throw PaymentRequiredError so API can return quote to frontend
    if (error instanceof PaymentRequiredError) {
      throw error;
    }
    console.error('Error fetching history:', error);
    return [];
  }
}

export async function getInfo(): Promise<{
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  totalMinted: string;
  totalBurned: string;
  totalTransactions: number;
}> {
  // Try to get from supply cache
  const client = getClient();
  try {
    const result = await client.queryBuilder()
      .collection(COLLECTIONS.supply)
      .selectAll()
      .limit(100)
      .execute();

    const records = (result.records || []) as SupplyRecord[];
    const sorted = records.sort((a, b) =>
      new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
    );

    if (sorted.length > 0) {
      const supply = sorted[0];
      return {
        name: STABLECOIN_NAME,
        symbol: STABLECOIN_SYMBOL,
        decimals: STABLECOIN_DECIMALS,
        totalSupply: supply.circulatingSupply,
        totalMinted: supply.totalMinted,
        totalBurned: supply.totalBurned,
        totalTransactions: supply.totalTransactions,
      };
    }
  } catch {
    // Cache miss, calculate from UTXOs
  }

  // Fallback: calculate from UTXOs
  const allUtxos = await getAllUTXOs();
  const utxoMap = new Map<string, UTXO>();

  for (const utxo of allUtxos) {
    const existing = utxoMap.get(utxo.id);
    if (!existing) {
      utxoMap.set(utxo.id, utxo);
    } else {
      const existingTime = new Date(existing.spentAt || existing.createdAt).getTime();
      const newTime = new Date(utxo.spentAt || utxo.createdAt).getTime();
      if (newTime > existingTime) {
        utxoMap.set(utxo.id, utxo);
      }
    }
  }

  const totalSupply = Array.from(utxoMap.values())
    .filter(u => !u.spent)
    .reduce((sum, u) => sum + BigInt(u.amount), 0n)
    .toString();

  return {
    name: STABLECOIN_NAME,
    symbol: STABLECOIN_SYMBOL,
    decimals: STABLECOIN_DECIMALS,
    totalSupply,
    totalMinted: totalSupply, // Can't calculate without full tx history
    totalBurned: '0',
    totalTransactions: 0,
  };
}

// Get supply metrics (from cache)
export async function getSupplyMetrics(): Promise<SupplyRecord | null> {
  const client = getClient();
  try {
    const result = await client.queryBuilder()
      .collection(COLLECTIONS.supply)
      .selectAll()
      .limit(100)
      .execute();

    const records = (result.records || []) as SupplyRecord[];
    const sorted = records.sort((a, b) =>
      new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
    );

    return sorted[0] || null;
  } catch {
    return null;
  }
}

// Get cached balance for an address
export async function getCachedBalance(address: string): Promise<BalanceRecord | null> {
  const client = getClient();
  try {
    const result = await client.queryBuilder()
      .collection(COLLECTIONS.balances)
      .selectAll()
      .limit(1000)
      .execute();

    const records = (result.records || []) as BalanceRecord[];
    const addressRecords = records
      .filter(r => r.address === address)
      .sort((a, b) =>
        new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
      );

    return addressRecords[0] || null;
  } catch {
    return null;
  }
}

// ============================================================================
// Verification Functions (for third-party auditors)
// ============================================================================

export async function verifyBalanceCache(address: string): Promise<{
  valid: boolean;
  cached: string | null;
  computed: string;
  hashValid: boolean;
}> {
  const cached = await getCachedBalance(address);
  const utxos = await getUnspentUTXOs(address);
  const computed = utxos.reduce((sum, u) => sum + BigInt(u.amount), 0n).toString();

  if (!cached) {
    return { valid: true, cached: null, computed, hashValid: true };
  }

  const utxoIds = utxos.map(u => u.id).sort();
  const expectedHash = toHex(sha256(new TextEncoder().encode(utxoIds.join(','))));

  return {
    valid: cached.balance === computed,
    cached: cached.balance,
    computed,
    hashValid: cached.balanceHash === expectedHash,
  };
}

export async function verifySupplyMetrics(): Promise<{
  valid: boolean;
  cached: string | null;
  computed: string;
}> {
  const supply = await getSupplyMetrics();
  const allUtxos = await getAllUTXOs();

  const utxoMap = new Map<string, UTXO>();
  for (const utxo of allUtxos) {
    const existing = utxoMap.get(utxo.id);
    if (!existing) {
      utxoMap.set(utxo.id, utxo);
    } else {
      const existingTime = new Date(existing.spentAt || existing.createdAt).getTime();
      const newTime = new Date(utxo.spentAt || utxo.createdAt).getTime();
      if (newTime > existingTime) {
        utxoMap.set(utxo.id, utxo);
      }
    }
  }

  const computed = Array.from(utxoMap.values())
    .filter(u => !u.spent)
    .reduce((sum, u) => sum + BigInt(u.amount), 0n)
    .toString();

  return {
    valid: supply ? supply.circulatingSupply === computed : true,
    cached: supply?.circulatingSupply || null,
    computed,
  };
}

// Export chain ID for frontend
export function getChainId(): string {
  return CHAIN_ID;
}

export { STABLECOIN_SYMBOL, STABLECOIN_DECIMALS, CHAIN_ID, COLLECTIONS };
