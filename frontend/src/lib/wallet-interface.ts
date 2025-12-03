// ============================================================================
// Wallet Types and Interfaces
// ============================================================================
// Core type definitions for wallet adapters and multi-chain payment support.
// These types are used across all wallet implementations.
// Supports x402 protocol for cross-chain USDC payments via facilitator.
// ============================================================================

// Chain type for payment processing
export type ChainType = 'cosmos' | 'evm' | 'solana';

// Payment method
export type PaymentMethod = 'native' | 'x402-facilitator';

// x402 Payment requirement from broker (PaymentOption)
// Matches X402PaymentRequirement from the SDK
export interface PaymentOption {
  scheme: 'exact';
  network: string;
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  resource: string;
  description: string;
  mimeType: string;
  maxTimeoutSeconds: number;
  extra?: {
    quoteId?: string;
    chainType?: ChainType;
    chainId?: number;
    paymentMethod?: PaymentMethod;
    facilitator?: string;
    tokenSymbol?: string;
    tokenDecimals?: number;
    [key: string]: any;
  };
}

// Payment result from wallet
export interface PaymentResult {
  txHash: string;
  network: string;
  sender: string;
  chainType: ChainType;
  paymentMethod: PaymentMethod;
}

// Quote format for payment callback (matches X402Quote from SDK)
export interface X402Quote {
  quoteId: string;
  totalCostTia: number;
  amountRaw: string;
  brokerAddress: string;
  description: string;
  expiresAt: number;
  chainType: ChainType;
  network: string;
  asset: string;
  tokenSymbol: string;
  tokenDecimals: number;
  paymentMethod: PaymentMethod;
  facilitator?: string;
  allOptions: PaymentOption[];
}

// Supported wallet types
export type WalletType = 'keplr' | 'metamask' | 'phantom' | 'coinbase' | 'custom';

// Wallet connection state
export interface WalletState {
  connected: boolean;
  address: string;           // Native address format (celestia1..., 0x..., base58)
  balance: string;           // Native token balance
  walletType: WalletType;
  chainId?: string;          // Optional chain identifier
}

// Input reference for signing (UTXO being spent)
export interface SignableInput {
  utxoId: string;
  amount: string;
}

// Output reference for signing (where funds go)
export interface SignableOutput {
  owner: string;
  chainId: string;
  amount: string;
}

// Signature result from wallet
export interface TransactionSignature {
  message: string;        // The message that was signed
  signature: string;      // Base64-encoded signature
  publicKey: string;      // Base64-encoded public key
  signatureType: SignatureType;
}

// Signature types for different wallet ecosystems
export type SignatureType =
  | 'secp256k1_cosmos_adr036'    // Keplr/Cosmos wallets using ADR-036
  | 'secp256k1_eip191'           // Metamask/EVM wallets using EIP-191
  | 'ed25519_solana'             // Phantom/Solana wallets
  | 'secp256k1_raw';             // Raw secp256k1 signature

// Complete signed request ready for API
export interface SignedTransactionRequest {
  inputs: SignableInput[];
  outputs: SignableOutput[];
  signature: TransactionSignature;
}

// Abstract wallet adapter interface
export interface WalletAdapter {
  // Wallet identification
  readonly walletType: WalletType;
  readonly name: string;

  // Check if wallet is available
  isInstalled(): boolean;

  // Connect and get wallet state
  connect(): Promise<WalletState>;

  // Disconnect wallet
  disconnect(): Promise<void>;

  // Get current balance (native token)
  getBalance(address: string): Promise<string>;

  // Sign a transaction with specific inputs and outputs
  signTransaction(
    inputs: SignableInput[],
    outputs: SignableOutput[],
    signerAddress: string
  ): Promise<SignedTransactionRequest>;

  // Send native token payment (for OnChainDB fees) - Celestia native
  sendPayment(toAddress: string, amount: number): Promise<string>;

  // Send payment via x402 protocol (cross-chain USDC) - optional, not all wallets support this
  // All payment details come from PaymentOption (asset, payTo, maxAmountRequired, network, etc.)
  sendX402Payment?(paymentOption: PaymentOption): Promise<PaymentResult>;

  // Get supported payment chains for this wallet
  getSupportedPaymentChains(): string[];
}

// Wallet info for UI display
export interface WalletInfo {
  type: WalletType;
  name: string;
  installed: boolean;
  icon?: string;
  description: string;
  supportedChains: string[];
}

// ============================================================================
// Helper Functions
// ============================================================================

// Normalize address based on chain type
// - EVM addresses (0x...) are case-insensitive, lowercase them
// - Solana addresses (base58) are case-sensitive, preserve case
// - Cosmos addresses (bech32) are case-insensitive, lowercase them
export function normalizeAddress(address: string): string {
  if (address.startsWith('0x')) {
    // EVM address - case insensitive
    return address.toLowerCase();
  }
  if (address.startsWith('celestia') || address.startsWith('cosmos') || address.startsWith('osmo')) {
    // Cosmos bech32 address - case insensitive
    return address.toLowerCase();
  }
  // Solana base58 address - case sensitive, preserve original
  return address;
}

// Application-specific chain ID for stablecoin signatures
export const STABLECOIN_CHAIN_ID = 'stablecoin-utxo-v1';

// Create signable message (deterministic, wallet-agnostic)
// The chainId parameter identifies the application/protocol being used
export function createSignableMessage(
  inputs: SignableInput[],
  outputs: SignableOutput[],
  chainId: string = STABLECOIN_CHAIN_ID
): string {
  const orderedData = {
    chainId,
    inputs: inputs.map(i => ({ amount: i.amount, utxoId: i.utxoId })),
    outputs: outputs.map(o => ({ amount: o.amount, chainId: o.chainId, owner: normalizeAddress(o.owner) })),
  };
  return JSON.stringify(orderedData);
}

// Helper to calculate change amount
export function calculateChange(
  inputs: SignableInput[],
  transferAmount: string
): string {
  const totalInput = inputs.reduce((sum, i) => sum + BigInt(i.amount), 0n);
  const change = totalInput - BigInt(transferAmount);
  return change.toString();
}

// Helper to convert display amount to raw amount
export function toRawAmount(displayAmount: number, decimals: number = 6): string {
  const multiplier = Math.pow(10, decimals);
  return Math.floor(displayAmount * multiplier).toString();
}

// Helper to convert raw amount to display amount
export function fromRawAmount(rawAmount: string, decimals: number = 6): number {
  const multiplier = Math.pow(10, decimals);
  return parseInt(rawAmount, 10) / multiplier;
}

// Detect chain from address format
export function detectChainFromAddress(address: string): string {
  if (address.startsWith('celestia')) return 'mocha-4';
  if (address.startsWith('cosmos')) return 'cosmos';
  if (address.startsWith('osmo')) return 'osmosis';
  if (address.startsWith('0x')) return 'eip155:1';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return 'solana-mainnet';
  return 'unknown';
}
