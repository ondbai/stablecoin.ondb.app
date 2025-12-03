import { SigningStargateClient, StargateClient } from '@cosmjs/stargate';
import { toBase64 } from '@cosmjs/encoding';

declare global {
  interface Window {
    keplr?: {
      enable: (chainId: string) => Promise<void>;
      getKey: (chainId: string) => Promise<{
        name: string;
        algo: string;
        pubKey: Uint8Array;
        address: Uint8Array;
        bech32Address: string;
      }>;
      getOfflineSigner: (chainId: string) => any;
      signArbitrary: (
        chainId: string,
        signer: string,
        data: string
      ) => Promise<{
        pub_key: { type: string; value: string };
        signature: string;
      }>;
    };
  }
}

const CHAIN_ID = 'mocha-4';

// Multiple RPC endpoints for fallback
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
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        return endpoint;
      }
    } catch {
      continue;
    }
  }
  // Return first endpoint as fallback
  return RPC_ENDPOINTS[0];
}

export interface WalletState {
  connected: boolean;
  address: string;
  balance: string;
}

export async function connectKeplr(): Promise<WalletState> {
  if (typeof window === 'undefined' || !window.keplr) {
    throw new Error('Keplr wallet not found. Please install Keplr extension.');
  }

  try {
    await window.keplr.enable(CHAIN_ID);
  } catch {
    throw new Error(
      'Celestia Mocha testnet not found in Keplr. Please add it manually.'
    );
  }

  const key = await window.keplr.getKey(CHAIN_ID);
  const balance = await getBalance(key.bech32Address);

  return {
    connected: true,
    address: key.bech32Address,
    balance,
  };
}

export async function getBalance(address: string): Promise<string> {
  try {
    const rpcEndpoint = await getWorkingRpcEndpoint();
    const client = await StargateClient.connect(rpcEndpoint);
    const balance = await client.getBalance(address, 'utia');
    const tia = parseInt(balance.amount) / 1_000_000;
    return tia.toFixed(6);
  } catch {
    return '0';
  }
}

export async function sendPayment(
  toAddress: string,
  amountUtia: number
): Promise<string> {
  if (typeof window === 'undefined' || !window.keplr) {
    throw new Error('Keplr wallet not found');
  }

  await window.keplr.enable(CHAIN_ID);
  const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID);
  const accounts = await offlineSigner.getAccounts();
  const fromAddress = accounts[0].address;

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

export function isKeplrInstalled(): boolean {
  return typeof window !== 'undefined' && !!window.keplr;
}

// ============================================================================
// Transaction Signing for UTXO Security (Input References Model)
// ============================================================================
// This signing model signs SPECIFIC UTXOs being spent, eliminating the need
// for nonces. The signature is bound to exact inputs and outputs.
// ============================================================================

// Chain ID for stablecoin signatures (separate from Celestia chain ID)
const STABLECOIN_CHAIN_ID = 'stablecoin-utxo-v1';

// Input reference for signing
export interface SignableInput {
  utxoId: string;
  amount: string;
}

// Output reference for signing
export interface SignableOutput {
  owner: string;
  amount: string;
}

// What gets signed (inputs + outputs + chainId)
export interface SignableTransaction {
  inputs: SignableInput[];
  outputs: SignableOutput[];
  chainId: string;
}

// Signature result
export interface TransactionSignature {
  message: string;
  signature: string;
  publicKey: string;
}

// Complete signed request ready for API
export interface SignedTransactionRequest {
  inputs: SignableInput[];
  outputs: SignableOutput[];
  signature: TransactionSignature;
}

/**
 * Create a signable message from transaction data
 * Must match the server-side createSignableMessage function
 */
function createSignableMessage(data: SignableTransaction): string {
  const orderedData = {
    chainId: data.chainId,
    inputs: data.inputs.map(i => ({ amount: i.amount, utxoId: i.utxoId })),
    outputs: data.outputs.map(o => ({ amount: o.amount, owner: o.owner })),
  };
  return JSON.stringify(orderedData);
}

/**
 * Sign a transaction with specific inputs and outputs
 * This is the core signing function - no nonces needed because
 * the signature is bound to specific UTXOs
 */
export async function signTransaction(
  inputs: SignableInput[],
  outputs: SignableOutput[],
  signerAddress: string
): Promise<SignedTransactionRequest> {
  if (typeof window === 'undefined' || !window.keplr) {
    throw new Error('Keplr wallet not found');
  }

  // Ensure Keplr is enabled for Celestia
  await window.keplr.enable(CHAIN_ID);

  // Get the key to verify the address matches
  const key = await window.keplr.getKey(CHAIN_ID);

  // Verify the signer address matches the connected wallet
  if (key.bech32Address.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error(
      `Connected wallet (${key.bech32Address}) does not match signer address (${signerAddress}). ` +
      `Please ensure you're signing from the correct wallet.`
    );
  }

  // Create the transaction data to sign
  const signableData: SignableTransaction = {
    inputs: inputs.map(i => ({
      utxoId: i.utxoId,
      amount: i.amount,
    })),
    outputs: outputs.map(o => ({
      owner: o.owner.toLowerCase(),
      amount: o.amount,
    })),
    chainId: STABLECOIN_CHAIN_ID,
  };

  // Create the message to sign
  const message = createSignableMessage(signableData);

  // Sign using Keplr's signArbitrary function
  const signResponse = await window.keplr.signArbitrary(
    CHAIN_ID,
    key.bech32Address,
    message
  );

  return {
    inputs: signableData.inputs,
    outputs: signableData.outputs,
    signature: {
      message,
      signature: signResponse.signature,
      publicKey: signResponse.pub_key.value,
    },
  };
}

/**
 * Sign a transfer transaction
 * Client must provide the specific UTXOs to spend
 */
export async function signTransfer(
  from: string,
  to: string,
  inputs: SignableInput[],
  transferAmount: string,
  changeAmount?: string
): Promise<SignedTransactionRequest> {
  // Build outputs
  const outputs: SignableOutput[] = [
    { owner: to.toLowerCase(), amount: transferAmount },
  ];

  // Add change output if needed
  if (changeAmount && BigInt(changeAmount) > 0n) {
    outputs.push({ owner: from.toLowerCase(), amount: changeAmount });
  }

  return signTransaction(inputs, outputs, from);
}

/**
 * Sign a burn transaction
 * Client must provide the specific UTXOs to spend
 */
export async function signBurn(
  from: string,
  inputs: SignableInput[],
  changeAmount?: string
): Promise<SignedTransactionRequest> {
  // Burn has no recipient output, only change if needed
  const outputs: SignableOutput[] = [];

  if (changeAmount && BigInt(changeAmount) > 0n) {
    outputs.push({ owner: from.toLowerCase(), amount: changeAmount });
  }

  return signTransaction(inputs, outputs, from);
}

/**
 * Helper to calculate change amount from inputs and transfer amount
 */
export function calculateChange(
  inputs: SignableInput[],
  transferAmount: string
): string {
  const totalInput = inputs.reduce((sum, i) => sum + BigInt(i.amount), 0n);
  const change = totalInput - BigInt(transferAmount);
  return change.toString();
}

/**
 * Helper to convert display amount to raw amount
 */
export function toRawAmount(displayAmount: number, decimals: number = 6): string {
  const multiplier = Math.pow(10, decimals);
  return Math.floor(displayAmount * multiplier).toString();
}

/**
 * Helper to convert raw amount to display amount
 */
export function fromRawAmount(rawAmount: string, decimals: number = 6): number {
  const multiplier = Math.pow(10, decimals);
  return parseInt(rawAmount, 10) / multiplier;
}
