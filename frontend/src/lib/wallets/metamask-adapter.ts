// ============================================================================
// MetaMask Wallet Adapter
// ============================================================================
// Implements the WalletAdapter interface for MetaMask (EVM ecosystem).
// Supports EIP-191 signing and x402 cross-chain USDC payments.
// All payment details come from the broker's PaymentOption response.
// ============================================================================

import {
  WalletAdapter,
  WalletState,
  SignableInput,
  SignableOutput,
  SignedTransactionRequest,
  createSignableMessage,
  PaymentOption,
  PaymentResult,
} from '../wallet-interface';

declare const window: Window & typeof globalThis & {
  ethereum?: any;
};

function getMetaMask(): any {
  if (typeof window === 'undefined') return null;
  const ethereum = window.ethereum;
  if (ethereum?.isMetaMask) return ethereum;
  if (ethereum?.providers) {
    return ethereum.providers.find((p: any) => p.isMetaMask);
  }
  return null;
}

// Chain configurations for switching networks
const EVM_CHAINS: Record<string, {
  chainId: string;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}> = {
  'base': {
    chainId: '0x2105',
    chainName: 'Base',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://mainnet.base.org'],
    blockExplorerUrls: ['https://basescan.org'],
  },
  'base-sepolia': {
    chainId: '0x14a34',
    chainName: 'Base Sepolia',
    nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia.base.org'],
    blockExplorerUrls: ['https://sepolia.basescan.org'],
  },
  'ethereum': {
    chainId: '0x1',
    chainName: 'Ethereum Mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://eth.llamarpc.com'],
    blockExplorerUrls: ['https://etherscan.io'],
  },
  'ethereum-sepolia': {
    chainId: '0xaa36a7',
    chainName: 'Sepolia',
    nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.sepolia.org'],
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
  },
};

export class MetaMaskAdapter implements WalletAdapter {
  readonly walletType = 'metamask' as const;
  readonly name = 'MetaMask';

  private connectedAddress: string | null = null;

  isInstalled(): boolean {
    return !!getMetaMask();
  }

  async connect(): Promise<WalletState> {
    const ethereum = getMetaMask();
    if (!ethereum) {
      throw new Error('MetaMask wallet not found. Please install MetaMask extension.');
    }

    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    this.connectedAddress = accounts[0];

    const chainId = await ethereum.request({ method: 'eth_chainId' });
    const balance = await this.getBalance(this.connectedAddress!);

    return {
      connected: true,
      address: this.connectedAddress!,
      balance,
      walletType: 'metamask',
      chainId: `eip155:${parseInt(chainId, 16)}`,
    };
  }

  async disconnect(): Promise<void> {
    this.connectedAddress = null;
  }

  async getBalance(address: string): Promise<string> {
    const ethereum = getMetaMask();
    if (!ethereum) return '0';

    try {
      const balance = await ethereum.request({
        method: 'eth_getBalance',
        params: [address, 'latest'],
      });
      return (parseInt(balance, 16) / 1e18).toFixed(6);
    } catch {
      return '0';
    }
  }

  async signTransaction(
    inputs: SignableInput[],
    outputs: SignableOutput[],
    signerAddress: string
  ): Promise<SignedTransactionRequest> {
    const ethereum = getMetaMask();
    if (!ethereum) throw new Error('MetaMask wallet not found');

    if (!this.connectedAddress) await this.connect();

    if (this.connectedAddress?.toLowerCase() !== signerAddress.toLowerCase()) {
      throw new Error(`Connected wallet does not match signer address`);
    }

    const normalizedOutputs = outputs.map(o => ({
      owner: o.owner.startsWith('0x') ? o.owner.toLowerCase() : o.owner,
      chainId: o.chainId,
      amount: o.amount,
    }));

    const message = createSignableMessage(inputs, normalizedOutputs);
    const signature = await ethereum.request({
      method: 'personal_sign',
      params: [message, this.connectedAddress],
    });

    return {
      inputs,
      outputs: normalizedOutputs,
      signature: {
        message,
        signature: Buffer.from(signature.slice(2), 'hex').toString('base64'),
        publicKey: Buffer.from(signerAddress.slice(2), 'hex').toString('base64'),
        signatureType: 'secp256k1_eip191',
      },
    };
  }

  async sendPayment(toAddress: string, amountWei: number): Promise<string> {
    const ethereum = getMetaMask();
    if (!ethereum) throw new Error('MetaMask wallet not found');
    if (!this.connectedAddress) await this.connect();

    return ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: this.connectedAddress,
        to: toAddress,
        value: '0x' + Math.floor(amountWei).toString(16),
      }],
    });
  }

  // x402 payment - uses all details from PaymentOption provided by broker
  async sendX402Payment(paymentOption: PaymentOption): Promise<PaymentResult> {
    const ethereum = getMetaMask();
    if (!ethereum) throw new Error('MetaMask wallet not found');
    if (!this.connectedAddress) await this.connect();

    // Switch to correct network if needed
    const chainConfig = EVM_CHAINS[paymentOption.network];
    if (chainConfig) {
      await this.switchChain(chainConfig);
    }

    const paymentMethod = paymentOption.extra?.paymentMethod;

    console.log('[MetaMask.sendX402Payment]', {
      network: paymentOption.network,
      asset: paymentOption.asset,
      payTo: paymentOption.payTo,
      amount: paymentOption.maxAmountRequired,
      paymentMethod,
    });

    // x402-facilitator uses EIP-712 signature
    if (paymentMethod === 'x402-facilitator') {
      return this.signForFacilitator(paymentOption);
    }

    // Direct ERC20 transfer
    return this.executeErc20Transfer(paymentOption);
  }

  // Sign EIP-712 authorization for x402 facilitator
  private async signForFacilitator(paymentOption: PaymentOption): Promise<PaymentResult> {
    const ethereum = getMetaMask();
    const chainId = await ethereum.request({ method: 'eth_chainId' });
    const chainIdNumber = parseInt(chainId, 16);

    // All values come from PaymentOption
    const tokenAddress = paymentOption.asset;
    const recipient = paymentOption.payTo;
    const amount = paymentOption.maxAmountRequired;

    // Generate nonce and validity window
    const nonce = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
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
        name: paymentOption.extra?.tokenSymbol === 'USDC' ? 'USD Coin' : 'Token',
        version: '2',
        chainId: chainIdNumber,
        verifyingContract: tokenAddress,
      },
      message: {
        from: this.connectedAddress!,
        to: recipient,
        value: amount,
        validAfter,
        validBefore,
        nonce,
      },
    };

    const signature = await ethereum.request({
      method: 'eth_signTypedData_v4',
      params: [this.connectedAddress, JSON.stringify(typedData)],
    });

    return {
      txHash: signature,
      network: paymentOption.network,
      sender: this.connectedAddress!,
      chainType: 'evm',
      paymentMethod: 'x402-facilitator',
    };
  }

  // Direct ERC20 transfer
  private async executeErc20Transfer(paymentOption: PaymentOption): Promise<PaymentResult> {
    const ethereum = getMetaMask();

    // All values from PaymentOption
    const tokenAddress = paymentOption.asset;
    const recipient = paymentOption.payTo;
    const amount = BigInt(paymentOption.maxAmountRequired);

    // ERC20 transfer(address,uint256)
    const data = '0xa9059cbb' +
      recipient.slice(2).padStart(64, '0') +
      amount.toString(16).padStart(64, '0');

    const txHash = await ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: this.connectedAddress,
        to: tokenAddress,
        data,
      }],
    });

    return {
      txHash,
      network: paymentOption.network,
      sender: this.connectedAddress!,
      chainType: 'evm',
      paymentMethod: 'native',
    };
  }

  private async switchChain(chainConfig: typeof EVM_CHAINS[string]): Promise<void> {
    const ethereum = getMetaMask();
    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainConfig.chainId }],
      });
    } catch (error: any) {
      if (error.code === 4902) {
        await ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [chainConfig],
        });
      } else {
        throw error;
      }
    }
  }

  getSupportedPaymentChains(): string[] {
    return ['ethereum', 'base', 'arbitrum', 'polygon'];
  }
}

export const metamaskAdapter = new MetaMaskAdapter();
