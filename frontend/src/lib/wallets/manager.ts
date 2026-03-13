// ============================================================================
// Wallet Manager
// ============================================================================
// Manages multiple wallet adapters and provides a unified interface
// for connecting to different wallets and handling payments.
// Supports multi-chain payments via x402 protocol for cross-chain USDC.
// ============================================================================

import {
  WalletAdapter,
  WalletState,
  WalletType,
  WalletInfo,
  SignableInput,
  SignableOutput,
  SignedTransactionRequest,
  PaymentOption,
  PaymentResult,
  X402Quote,
} from '../wallet-interface';
import { KeplrAdapter, keplrAdapter } from './keplr-adapter';
import { MetaMaskAdapter, metamaskAdapter } from './metamask-adapter';
import { PhantomAdapter, phantomAdapter } from './phantom-adapter';

// Available wallet adapters
const adapters: Record<WalletType, WalletAdapter | null> = {
  keplr: keplrAdapter,
  phantom: phantomAdapter,
  metamask: metamaskAdapter,
};

// Get a specific wallet adapter
export function getWalletAdapter(type: WalletType): WalletAdapter | null {
  return adapters[type] || null;
}

// Get list of available wallets with their status
export function getAvailableWallets(): WalletInfo[] {
  return [
    {
      type: 'keplr',
      name: 'Keplr',
      installed: keplrAdapter.isInstalled(),
      description: 'Cosmos ecosystem wallet (Celestia native payments)',
      supportedChains: keplrAdapter.getSupportedPaymentChains(),
    },
    {
      type: 'phantom',
      name: 'Phantom',
      installed: phantomAdapter.isInstalled(),
      description: 'Solana wallet with EVM support (x402 USDC payments)',
      supportedChains: phantomAdapter.getSupportedPaymentChains(),
    },
    {
      type: 'metamask',
      name: 'MetaMask',
      installed: metamaskAdapter.isInstalled(),
      description: 'EVM ecosystem wallet (Ethereum, Arbitrum, Base - x402 USDC payments)',
      supportedChains: metamaskAdapter.getSupportedPaymentChains(),
    },
  ];
}

// Wallet manager class for stateful operations
export class WalletManager {
  private currentAdapter: WalletAdapter | null = null;
  private currentState: WalletState | null = null;

  // Get current wallet state
  getState(): WalletState | null {
    return this.currentState;
  }

  // Get current adapter
  getAdapter(): WalletAdapter | null {
    return this.currentAdapter;
  }

  // Check if connected
  isConnected(): boolean {
    return this.currentState?.connected ?? false;
  }

  // Get connected address
  getAddress(): string | null {
    return this.currentState?.address ?? null;
  }

  // Get connected wallet type
  getWalletType(): WalletType | null {
    return this.currentState?.walletType ?? null;
  }

  // Connect to a specific wallet
  async connect(type: WalletType): Promise<WalletState> {
    const adapter = getWalletAdapter(type);
    if (!adapter) {
      throw new Error(`Wallet type ${type} is not supported`);
    }

    if (!adapter.isInstalled()) {
      throw new Error(`${adapter.name} wallet is not installed`);
    }

    // Disconnect from current wallet if different
    if (this.currentAdapter && this.currentAdapter.walletType !== type) {
      await this.disconnect();
    }

    const state = await adapter.connect();
    this.currentAdapter = adapter;
    this.currentState = state;
    return state;
  }

  // Disconnect current wallet
  async disconnect(): Promise<void> {
    if (this.currentAdapter) {
      await this.currentAdapter.disconnect();
    }
    this.currentAdapter = null;
    this.currentState = null;
  }

  // Sign a transaction
  async signTransaction(
    inputs: SignableInput[],
    outputs: SignableOutput[],
    signerAddress: string
  ): Promise<SignedTransactionRequest> {
    if (!this.currentAdapter) {
      throw new Error('No wallet connected');
    }
    return this.currentAdapter.signTransaction(inputs, outputs, signerAddress);
  }

  // Send payment (for OnChainDB fees) - Native Celestia payment
  async sendPayment(toAddress: string, amount: number): Promise<string> {
    if (!this.currentAdapter) {
      throw new Error('No wallet connected');
    }
    return this.currentAdapter.sendPayment(toAddress, amount);
  }

  // Send payment via x402 protocol (cross-chain USDC)
  // All payment details come from PaymentOption (asset, payTo, maxAmountRequired, network, etc.)
  async sendX402Payment(paymentOption: PaymentOption): Promise<PaymentResult> {
    if (!this.currentAdapter) {
      throw new Error('No wallet connected');
    }

    if (!this.currentAdapter.sendX402Payment) {
      throw new Error(
        `${this.currentAdapter.name} does not support x402 cross-chain payments. ` +
        'Please use a wallet that supports EVM networks (MetaMask, Phantom with EVM).'
      );
    }

    return this.currentAdapter.sendX402Payment(paymentOption);
  }

  // Check if current wallet supports x402 payments
  supportsX402Payments(): boolean {
    return !!this.currentAdapter?.sendX402Payment;
  }

  // Get supported payment chains for current wallet
  getSupportedPaymentChains(): string[] {
    if (!this.currentAdapter) {
      return [];
    }
    return this.currentAdapter.getSupportedPaymentChains();
  }

  // Get balance
  async getBalance(address?: string): Promise<string> {
    if (!this.currentAdapter) {
      throw new Error('No wallet connected');
    }
    const addr = address || this.currentState?.address;
    if (!addr) {
      throw new Error('No address provided');
    }
    return this.currentAdapter.getBalance(addr);
  }

  // Create a payment callback for use with OnDBClient.store()
  // This returns a function that handles the x402 payment flow automatically
  createPaymentCallback(): (quote: X402Quote) => Promise<PaymentResult> {
    return async (quote: X402Quote): Promise<PaymentResult> => {
      if (!this.currentAdapter) {
        throw new Error('No wallet connected. Please connect a wallet first.');
      }

      // Check if quote has multi-chain options
      if (quote.allOptions && Array.isArray(quote.allOptions) && quote.allOptions.length > 0) {
        const compatibleOption = this.findCompatiblePaymentOption(quote.allOptions);

        if (compatibleOption) {
          // Use x402 facilitator payment if available and supported
          if (
            compatibleOption.extra?.paymentMethod === 'x402-facilitator' &&
            this.supportsX402Payments()
          ) {
            return this.sendX402Payment(compatibleOption);
          }

          // Use native payment for Celestia
          if (compatibleOption.extra?.chainType === 'cosmos') {
            const amountUtia = Math.ceil(quote.totalCost * 1_000_000);
            const txHash = await this.sendPayment(quote.brokerAddress, amountUtia);
            return {
              txHash,
              network: compatibleOption.network,
              sender: this.currentState?.address || '',
              chainType: 'cosmos',
              paymentMethod: 'native',
            };
          }
        }
      }

      // Fallback to native Celestia payment
      const amountUtia = Math.ceil(quote.totalCost * 1_000_000);
      const txHash = await this.sendPayment(quote.brokerAddress, amountUtia);
      return {
        txHash,
        network: 'mocha-4',
        sender: this.currentState?.address || '',
        chainType: 'cosmos',
        paymentMethod: 'native',
      };
    };
  }

  // Find a compatible payment option for the connected wallet
  private findCompatiblePaymentOption(options: PaymentOption[]): PaymentOption | null {
    const walletType = this.currentState?.walletType;
    const supportedChains = this.getSupportedPaymentChains();

    // First, try to find a native Celestia option for Keplr
    if (walletType === 'keplr') {
      const celestiaOption = options.find(
        opt => opt.extra?.chainType === 'cosmos' || opt.network === 'mocha-4'
      );
      if (celestiaOption) return celestiaOption;
    }

    // For EVM wallets (MetaMask), find an EVM x402 facilitator option
    if (walletType === 'metamask') {
      const x402Option = options.find(
        opt =>
          opt.extra?.paymentMethod === 'x402-facilitator' &&
          opt.extra?.chainType === 'evm'
      );
      if (x402Option) return x402Option;

      // Fall back to direct ERC20 transfer
      const evmOption = options.find(
        opt => opt.extra?.chainType === 'evm'
      );
      if (evmOption) return evmOption;
    }

    // For Phantom, try EVM first (via Phantom's Ethereum provider), then Solana
    if (walletType === 'phantom') {
      // Prefer EVM x402 facilitator if Phantom's Ethereum provider is available
      const evmOption = options.find(
        opt =>
          opt.extra?.paymentMethod === 'x402-facilitator' &&
          opt.extra?.chainType === 'evm'
      );
      if (evmOption) return evmOption;

      // Fall back to Solana x402
      const solanaOption = options.find(
        opt =>
          opt.extra?.paymentMethod === 'x402-facilitator' &&
          opt.extra?.chainType === 'solana'
      );
      if (solanaOption) return solanaOption;
    }

    // Return any compatible option based on supported chains
    return options.find(opt => supportedChains.some(chain =>
      opt.network.includes(chain) || chain.includes(opt.network)
    )) || null;
  }
}

// Singleton wallet manager instance
export const walletManager = new WalletManager();

// Re-export adapter classes and singletons
export { KeplrAdapter, keplrAdapter };
export { MetaMaskAdapter, metamaskAdapter };
export { PhantomAdapter, phantomAdapter };
