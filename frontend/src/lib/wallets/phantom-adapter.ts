// ============================================================================
// Phantom Wallet Adapter
// ============================================================================
// Implements the WalletAdapter interface for Phantom (Solana ecosystem).
// Note: Phantom also supports EVM chains via its Ethereum provider.
// This adapter supports both Solana signing and x402 facilitator payments.
// ============================================================================

import {
  WalletAdapter,
  WalletState,
  SignableInput,
  SignableOutput,
  SignedTransactionRequest,
  createSignableMessage,
  normalizeAddress,
  PaymentOption,
  PaymentResult,
} from '../wallet-interface';

// Declare window for browser environments
declare const window: Window & typeof globalThis & {
  phantom?: {
    solana?: any;
    ethereum?: any;
  };
};

// Solana RPC endpoints
const SOLANA_RPC_ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-mainnet.g.alchemy.com/v2/demo',
  'https://rpc.ankr.com/solana',
];

// Helper to get Phantom's Solana provider
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPhantomSolana(): any {
  if (typeof window === 'undefined') return null;
  return window.phantom?.solana;
}

// Helper to get Phantom's Ethereum provider (for EVM chains)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPhantomEthereum(): any {
  if (typeof window === 'undefined') return null;
  return window.phantom?.ethereum;
}

// Helper to encode message for Solana signing
function encodeMessage(message: string): Uint8Array {
  return new TextEncoder().encode(message);
}

// Helper to convert Uint8Array to base64
function uint8ArrayToBase64(array: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < array.length; i++) {
    binary += String.fromCharCode(array[i]);
  }
  return btoa(binary);
}

export class PhantomAdapter implements WalletAdapter {
  readonly walletType = 'phantom' as const;
  readonly name = 'Phantom';

  private connectedAddress: string | null = null;
  private publicKey: Uint8Array | null = null;

  isInstalled(): boolean {
    return !!getPhantomSolana();
  }

  async connect(): Promise<WalletState> {
    const phantom = getPhantomSolana();
    if (!phantom) {
      throw new Error('Phantom wallet not found. Please install Phantom extension.');
    }

    try {
      const response = await phantom.connect();
      this.connectedAddress = response.publicKey.toString();
      this.publicKey = response.publicKey.toBytes();

      const balance = await this.getBalance(this.connectedAddress!);

      return {
        connected: true,
        address: this.connectedAddress!,
        balance,
        walletType: 'phantom',
        chainId: 'solana-mainnet',
      };
    } catch {
      throw new Error('Failed to connect to Phantom wallet');
    }
  }

  async disconnect(): Promise<void> {
    const phantom = getPhantomSolana();
    if (phantom) {
      await phantom.disconnect();
    }
    this.connectedAddress = null;
    this.publicKey = null;
  }

  async getBalance(address: string): Promise<string> {
    // Solana RPC balance query
    try {
      const response = await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [address],
        }),
      });
      const data = await response.json() as { result?: { value?: number } };
      if (data.result?.value) {
        const sol = data.result.value / 1e9;
        return sol.toFixed(6);
      }
      return '0';
    } catch {
      return '0';
    }
  }

  async signTransaction(
    inputs: SignableInput[],
    outputs: SignableOutput[],
    signerAddress: string
  ): Promise<SignedTransactionRequest> {
    const phantom = getPhantomSolana();
    if (!phantom) {
      throw new Error('Phantom wallet not found');
    }

    // Verify connected
    if (!this.connectedAddress) {
      await this.connect();
    }

    // Verify signer address matches
    if (this.connectedAddress !== signerAddress) {
      throw new Error(
        `Connected wallet (${this.connectedAddress}) does not match signer address (${signerAddress}).`
      );
    }

    // Normalize outputs
    const normalizedOutputs = outputs.map(o => ({
      owner: normalizeAddress(o.owner),
      chainId: o.chainId,
      amount: o.amount,
    }));

    // Create the message to sign
    const message = createSignableMessage(inputs, normalizedOutputs);
    const messageBytes = encodeMessage(message);

    // Sign using Phantom's signMessage
    const signResponse = await phantom.signMessage(messageBytes, 'utf8');

    return {
      inputs,
      outputs: normalizedOutputs,
      signature: {
        message,
        signature: uint8ArrayToBase64(signResponse.signature),
        publicKey: uint8ArrayToBase64(this.publicKey!),
        signatureType: 'ed25519_solana',
      },
    };
  }

  async sendPayment(toAddress: string, amount: number): Promise<string> {
    // Try EVM payment via Phantom's Ethereum provider
    const ethereum = getPhantomEthereum();
    if (ethereum) {
      return this.sendEvmPayment(toAddress, amount);
    }

    // Phantom/Solana native payments would require additional SDK integration
    throw new Error(
      'Native Solana payments not implemented. ' +
      'For OnChainDB payments, please use x402 cross-chain payment or a Celestia wallet like Keplr.'
    );
  }

  // Send payment via Phantom's EVM provider (for ERC20 transfers)
  private async sendEvmPayment(toAddress: string, amountUtia: number): Promise<string> {
    const ethereum = getPhantomEthereum();
    if (!ethereum) {
      throw new Error('Phantom EVM provider not available');
    }

    // Request account access
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    const fromAddress = accounts[0];

    // For native ETH transfer (simplified - in production use proper gas estimation)
    const amountHex = '0x' + amountUtia.toString(16);

    const txHash = await ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: fromAddress,
        to: toAddress,
        value: amountHex,
      }],
    });

    return txHash;
  }

  // x402 payment - uses all details from PaymentOption provided by broker
  async sendX402Payment(paymentOption: PaymentOption): Promise<PaymentResult> {
    const chainType = paymentOption.extra?.chainType;

    // Handle Solana payments
    if (chainType === 'solana') {
      return this.sendSolanaX402Payment(paymentOption);
    }

    // Handle EVM payments via Phantom's Ethereum provider
    const ethereum = getPhantomEthereum();
    if (!ethereum) {
      throw new Error(
        'Phantom EVM provider not available. Please switch to an EVM network in Phantom.'
      );
    }

    // Request account access
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    const fromAddress = accounts[0];

    const paymentMethod = paymentOption.extra?.paymentMethod;

    console.log('[Phantom.sendX402Payment] Payment option:', {
      scheme: paymentOption.scheme,
      paymentMethod,
      network: paymentOption.network,
      chainType,
    });

    // Use x402 facilitator if specified
    if (paymentMethod === 'x402-facilitator') {
      return this.executeEvmX402FacilitatorPayment(paymentOption, fromAddress);
    }

    // Direct ERC20 transfer
    const tokenAddress = paymentOption.asset;
    const recipientAddress = paymentOption.payTo;
    const amountWei = BigInt(paymentOption.maxAmountRequired);

    // ERC20 transfer data (transfer function selector + params)
    const transferData = this.encodeErc20Transfer(recipientAddress, amountWei);

    const txHash = await ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: fromAddress,
        to: tokenAddress,
        data: transferData,
      }],
    });

    return {
      txHash,
      network: paymentOption.network,
      sender: fromAddress,
      chainType: 'evm',
      paymentMethod: 'native',
    };
  }

  // Execute x402 facilitator payment via EVM
  private async executeEvmX402FacilitatorPayment(
    paymentOption: PaymentOption,
    fromAddress: string
  ): Promise<PaymentResult> {
    const ethereum = getPhantomEthereum();
    const facilitatorUrl = paymentOption.extra?.facilitator;

    if (!facilitatorUrl) {
      throw new Error('No x402 facilitator URL provided in payment option');
    }

    const tokenAddress = paymentOption.asset;
    const amountBigInt = BigInt(paymentOption.maxAmountRequired);
    const recipientAddress = paymentOption.payTo;

    // Get current chain ID
    const chainId = await ethereum.request({ method: 'eth_chainId' });
    const chainIdNumber = parseInt(chainId, 16);

    // Generate random nonce for ERC-3009
    const nonce = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Set validity window
    const validAfter = Math.floor(Date.now() / 1000) - 60;
    const validBefore = Math.floor(Date.now() / 1000) + 3600;

    // EIP-712 typed data for ERC-3009 TransferWithAuthorization
    const typedData = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      domain: {
        name: 'USD Coin',
        version: '2',
        chainId: chainIdNumber,
        verifyingContract: tokenAddress,
      },
      message: {
        from: fromAddress,
        to: recipientAddress,
        value: amountBigInt.toString(),
        validAfter: validAfter,
        validBefore: validBefore,
        nonce: nonce,
      },
    };

    // Sign with EIP-712
    const signature = await ethereum.request({
      method: 'eth_signTypedData_v4',
      params: [fromAddress, JSON.stringify(typedData)],
    });

    return {
      txHash: signature,
      network: paymentOption.network,
      sender: fromAddress,
      chainType: 'evm',
      paymentMethod: 'x402-facilitator',
    };
  }

  // Send x402 payment from Solana
  private async sendSolanaX402Payment(
    paymentOption: PaymentOption
  ): Promise<PaymentResult> {
    const phantom = getPhantomSolana();
    if (!phantom) {
      throw new Error('Phantom Solana wallet not found');
    }

    if (!this.connectedAddress) {
      await this.connect();
    }

    // For Solana x402 payments, we would need to integrate with the x402 facilitator
    // This is a placeholder for future implementation
    throw new Error(
      'Solana x402 payments require additional facilitator integration. ' +
      'Please use an EVM wallet for now.'
    );
  }

  // Encode ERC20 transfer function call
  private encodeErc20Transfer(to: string, amount: bigint): string {
    // Function selector for transfer(address,uint256): 0xa9059cbb
    const selector = 'a9059cbb';
    // Pad address to 32 bytes (remove 0x, pad to 64 chars)
    const paddedTo = to.replace('0x', '').padStart(64, '0');
    // Pad amount to 32 bytes
    const paddedAmount = amount.toString(16).padStart(64, '0');
    return '0x' + selector + paddedTo + paddedAmount;
  }

  getSupportedPaymentChains(): string[] {
    const chains: string[] = ['solana'];

    // Check if EVM is available via Phantom
    if (getPhantomEthereum()) {
      chains.push('ethereum', 'arbitrum', 'base', 'polygon');
    }

    return chains;
  }
}

// Singleton instance
export const phantomAdapter = new PhantomAdapter();
