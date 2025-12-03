// ============================================================================
// Keplr Wallet Adapter
// ============================================================================
// Implements the WalletAdapter interface for Keplr (Cosmos ecosystem).
// Uses ADR-036 for arbitrary message signing.
// ============================================================================

import {
  WalletAdapter,
  WalletState,
  SignableInput,
  SignableOutput,
  SignedTransactionRequest,
  createSignableMessage,
  normalizeAddress,
} from '../wallet-interface';

// Declare window for browser environments
declare const window: Window & typeof globalThis & {
  keplr?: any;
};

// Helper to get Keplr instance (avoids duplicate type declarations)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getKeplr(): any {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return window.keplr;
}

// Celestia Mocha testnet configuration
const CELESTIA_CHAIN_ID = 'mocha-4';

const RPC_ENDPOINTS = [
  'https://rpc-mocha.pops.one',
  'https://celestia-testnet-rpc.polkachu.com',
  'https://celestia-mocha-rpc.publicnode.com:443',
];

async function getWorkingRpcEndpoint(): Promise<string> {
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/status`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        return endpoint;
      }
    } catch {
      continue;
    }
  }
  return RPC_ENDPOINTS[0];
}

export class KeplrAdapter implements WalletAdapter {
  readonly walletType = 'keplr' as const;
  readonly name = 'Keplr';

  private connectedAddress: string | null = null;

  isInstalled(): boolean {
    return !!getKeplr();
  }

  async connect(): Promise<WalletState> {
    const keplr = getKeplr();
    if (!keplr) {
      throw new Error('Keplr wallet not found. Please install Keplr extension.');
    }

    try {
      await keplr.enable(CELESTIA_CHAIN_ID);
    } catch {
      throw new Error(
        'Celestia Mocha testnet not found in Keplr. Please add it manually.'
      );
    }

    const key = await keplr.getKey(CELESTIA_CHAIN_ID);
    this.connectedAddress = key.bech32Address;
    const balance = await this.getBalance(key.bech32Address);

    return {
      connected: true,
      address: key.bech32Address,
      balance,
      walletType: 'keplr',
      chainId: CELESTIA_CHAIN_ID,
    };
  }

  async disconnect(): Promise<void> {
    this.connectedAddress = null;
  }

  async getBalance(address: string): Promise<string> {
    try {
      const rpcEndpoint = await getWorkingRpcEndpoint();
      // Use REST API for balance query (simpler than full cosmjs import)
      const restEndpoint = rpcEndpoint.replace('/rpc', '/rest').replace(':443', '');
      const response = await fetch(
        `${restEndpoint}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=utia`
      );
      if (response.ok) {
        const data = await response.json() as { balance?: { amount?: string } };
        const amount = data.balance?.amount || '0';
        const tia = parseInt(amount) / 1_000_000;
        return tia.toFixed(6);
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
    const keplr = getKeplr();
    if (!keplr) {
      throw new Error('Keplr wallet not found');
    }

    await keplr.enable(CELESTIA_CHAIN_ID);
    const key = await keplr.getKey(CELESTIA_CHAIN_ID);

    // Verify the signer address matches the connected wallet
    if (key.bech32Address.toLowerCase() !== signerAddress.toLowerCase()) {
      throw new Error(
        `Connected wallet (${key.bech32Address}) does not match signer address (${signerAddress}).`
      );
    }

    // Normalize outputs (preserve chainId, normalize addresses based on chain type)
    const normalizedOutputs = outputs.map(o => ({
      owner: normalizeAddress(o.owner),
      chainId: o.chainId,
      amount: o.amount,
    }));

    // Create the message to sign
    const message = createSignableMessage(inputs, normalizedOutputs);

    // Sign using Keplr's signArbitrary (ADR-036)
    const signResponse = await keplr.signArbitrary(
      CELESTIA_CHAIN_ID,
      key.bech32Address,
      message
    );

    return {
      inputs,
      outputs: normalizedOutputs,
      signature: {
        message,
        signature: signResponse.signature,
        publicKey: signResponse.pub_key.value,
        signatureType: 'secp256k1_cosmos_adr036',
      },
    };
  }

  async sendPayment(toAddress: string, amountUtia: number): Promise<string> {
    const keplr = getKeplr();
    if (!keplr) {
      throw new Error('Keplr wallet not found');
    }

    await keplr.enable(CELESTIA_CHAIN_ID);
    const offlineSigner = keplr.getOfflineSigner(CELESTIA_CHAIN_ID);
    const accounts = await offlineSigner.getAccounts();
    const fromAddress = accounts[0].address;

    // Import cosmjs dynamically
    let SigningStargateClient: any;
    try {
      const cosmjs = await import('@cosmjs/stargate');
      SigningStargateClient = cosmjs.SigningStargateClient;
    } catch (e) {
      throw new Error(
        'Failed to import @cosmjs/stargate. Please install it: npm install @cosmjs/stargate'
      );
    }

    const rpcEndpoint = await getWorkingRpcEndpoint();
    const client = await SigningStargateClient.connectWithSigner(
      rpcEndpoint,
      offlineSigner
    );

    const result = await client.sendTokens(
      fromAddress,
      toAddress,
      [{ denom: 'utia', amount: amountUtia.toString() }],
      {
        amount: [{ denom: 'utia', amount: '2000' }],
        gas: '100000',
      },
      'OnChainDB payment'
    );

    if (result.code !== 0) {
      throw new Error(`Transaction failed: ${result.rawLog}`);
    }

    return result.transactionHash;
  }

  getSupportedPaymentChains(): string[] {
    return ['celestia', 'mocha-4'];
  }
}

// Singleton instance
export const keplrAdapter = new KeplrAdapter();
