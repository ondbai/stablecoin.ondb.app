// ============================================================================
// Wallets Module - Multi-Chain Wallet Support for Stablecoin App
// ============================================================================
// This module provides wallet adapters for various blockchain ecosystems:
// - Keplr (Cosmos/Celestia) - Native TIA payments
// - MetaMask (EVM) - x402 cross-chain USDC payments
// - Phantom (Solana + EVM) - x402 cross-chain USDC payments
// ============================================================================

// Types from wallet-interface
export type {
  WalletType,
  WalletState,
  WalletAdapter,
  WalletInfo,
  SignableInput,
  SignableOutput,
  SignedTransactionRequest,
  TransactionSignature,
  SignatureType,
  PaymentOption,
  PaymentResult,
} from '../wallet-interface';

// Type utilities from wallet-interface
export {
  normalizeAddress,
  createSignableMessage,
  calculateChange,
  toRawAmount,
  fromRawAmount,
  detectChainFromAddress,
  STABLECOIN_CHAIN_ID,
} from '../wallet-interface';

// Wallet Manager
export {
  WalletManager,
  walletManager,
  getWalletAdapter,
  getAvailableWallets,
} from './manager';

// Individual Adapters
export { KeplrAdapter, keplrAdapter } from './keplr-adapter';
export { MetaMaskAdapter, metamaskAdapter } from './metamask-adapter';
export { PhantomAdapter, phantomAdapter } from './phantom-adapter';
