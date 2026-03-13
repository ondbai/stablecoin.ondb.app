'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/header';
import { StatsDashboard } from '@/components/stats-dashboard';
import { BalanceChecker } from '@/components/balance-checker';
import { TransactionHistory } from '@/components/transaction-history';
import { MintCard } from '@/components/operations/mint-card';
import { BurnCard } from '@/components/operations/burn-card';
import { TransferCard } from '@/components/operations/transfer-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  walletManager,
  getAvailableWallets,
  WalletState,
  WalletType,
  WalletInfo,
  PaymentOption,
  PaymentResult,
} from '@/lib/wallets';
import {
  SignedTransactionRequest,
  toRawAmount,
  calculateChange,
} from '@/lib/wallet-interface';
import { Sparkles, Flame, Send, Wallet, History } from 'lucide-react';
import { X402Quote } from '@onchaindb/sdk';

interface StablecoinInfo {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  totalMinted?: string;
  totalBurned?: string;
  totalTransactions?: number;
}

interface TransactionInput {
  utxoId: string;
  owner: string;
  chainId?: string;
  amount: string;
}

interface TransactionOutput {
  index: number;
  owner: string;
  chainId?: string;
  amount: string;
}

interface Transaction {
  id: string;
  type: 'mint' | 'burn' | 'transfer';
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
  timestamp: string;
  blockHeight?: number;
}

interface UTXO {
  id: string;
  owner: string;
  chainId: string;
  amount: string;
  spent: boolean;
  createdInTx: string;
  createdAt: string;
}

function detectChainFromAddress(address: string): string {
  if (address.startsWith('celestia')) return 'mocha-4';
  if (address.startsWith('cosmos')) return 'cosmos';
  if (address.startsWith('osmo')) return 'osmosis';
  if (address.startsWith('0x')) return 'eip155:1';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return 'solana-mainnet';
  return 'unknown';
}

function selectUTXOsForAmount(
  utxos: UTXO[],
  targetAmount: bigint
): { selected: UTXO[]; total: bigint } {
  const sorted = [...utxos].sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)));
  const selected: UTXO[] = [];
  let total = 0n;

  for (const utxo of sorted) {
    if (total >= targetAmount) break;
    selected.push(utxo);
    total += BigInt(utxo.amount);
  }

  return { selected, total };
}

export default function Home() {
  const [info, setInfo] = useState<StablecoinInfo | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [availableWallets, setAvailableWallets] = useState<WalletInfo[]>([]);

  // Balance state
  const [balanceResult, setBalanceResult] = useState<{ balance: number; utxoCount: number } | null>(
    null
  );
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [utxos, setUtxos] = useState<UTXO[]>([]);

  // Mint state
  const [mintResult, setMintResult] = useState<string | null>(null);
  const [mintError, setMintError] = useState<string | null>(null);
  const [mintLoading, setMintLoading] = useState(false);

  // Burn state
  const [burnResult, setBurnResult] = useState<string | null>(null);
  const [burnError, setBurnError] = useState<string | null>(null);
  const [burnLoading, setBurnLoading] = useState(false);

  // Transfer state
  const [transferResult, setTransferResult] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferLoading, setTransferLoading] = useState(false);

  // History state
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    loadInfo();
    setAvailableWallets(getAvailableWallets());
  }, []);

  const loadInfo = async () => {
    try {
      const res = await fetch('/api/info');
      const data = await res.json();
      setInfo(data);
    } catch (error) {
      console.error('Failed to load info:', error);
    }
  };

  const handleConnectWallet = async (walletType: WalletType) => {
    setWalletError(null);
    try {
      const state = await walletManager.connect(walletType);
      setWallet(state);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : 'Failed to connect wallet');
    }
  };

  const handleDisconnectWallet = async () => {
    await walletManager.disconnect();
    setWallet(null);
  };

  // Handle payment with multi-chain support
  const handlePaymentAndRetry = async (
    quote: X402Quote,
    retryFn: (paymentTxHash: string, paymentResult?: PaymentResult) => Promise<unknown>
  ): Promise<unknown> => {
    console.log('[handlePaymentAndRetry] Starting payment flow:', {
      totalCost: quote.totalCost,
      brokerAddress: quote.brokerAddress,
      optionsCount: quote.allOptions?.length || 0,
      walletType: wallet?.walletType,
    });

    if (!wallet) {
      throw new Error('Please connect your wallet first');
    }

    const supportedChains = walletManager.getSupportedPaymentChains();
    console.log('[handlePaymentAndRetry] Supported chains:', supportedChains);

    // Check if quote has multi-chain options
    if (quote.allOptions && quote.allOptions.length > 0) {
      console.log('[handlePaymentAndRetry] Available options:', quote.allOptions.map(o => ({
        network: o.network,
        asset: o.asset,
        paymentMethod: o.extra?.paymentMethod,
        chainType: o.extra?.chainType,
      })));

      // Find a compatible payment option for the connected wallet
      const compatibleOption = findCompatiblePaymentOption(quote.allOptions, supportedChains);
      console.log('[handlePaymentAndRetry] Compatible option found:', compatibleOption ? {
        network: compatibleOption.network,
        asset: compatibleOption.asset,
        paymentMethod: compatibleOption.extra?.paymentMethod,
        chainType: compatibleOption.extra?.chainType,
      } : null);

      if (compatibleOption) {
        // Use x402 facilitator payment if available and supported
        if (
          compatibleOption.extra?.paymentMethod === 'x402-facilitator' &&
          walletManager.supportsX402Payments()
        ) {
          console.log('[handlePaymentAndRetry] Using x402 facilitator payment');
          const paymentResult = await walletManager.sendX402Payment(compatibleOption);
          console.log('[handlePaymentAndRetry] x402 payment result:', paymentResult);
          return retryFn(paymentResult.txHash, paymentResult);
        }

        // Use native payment for Celestia
        if (compatibleOption.extra?.chainType === 'cosmos') {
          console.log('[handlePaymentAndRetry] Using native Cosmos payment');
          const amountUtia = Math.ceil(quote.totalCost * 1_000_000);
          const txHash = await walletManager.sendPayment(quote.brokerAddress, amountUtia);
          console.log('[handlePaymentAndRetry] Cosmos payment txHash:', txHash);
          return retryFn(txHash);
        }

        console.log('[handlePaymentAndRetry] Compatible option found but no matching payment method');
      }
    }

    // Fallback to native Celestia payment
    console.log('[handlePaymentAndRetry] Falling back to native Celestia payment');
    const amountUtia = Math.ceil(quote.totalCost * 1_000_000);
    const txHash = await walletManager.sendPayment(quote.brokerAddress, amountUtia);
    console.log('[handlePaymentAndRetry] Fallback payment txHash:', txHash);
    return retryFn(txHash);
  };

  // Find a compatible payment option for the connected wallet
  const findCompatiblePaymentOption = (
    options: PaymentOption[],
    supportedChains: string[]
  ): PaymentOption | null => {
    // First, try to find a native Celestia option for Keplr
    if (wallet?.walletType === 'keplr') {
      const celestiaOption = options.find(
        opt => opt.extra?.chainType === 'cosmos' || opt.network === 'mocha-4'
      );
      if (celestiaOption) return celestiaOption;
    }

    // For MetaMask, find an EVM x402 facilitator option
    if (wallet?.walletType === 'metamask') {
      const x402Option = options.find(
        opt =>
          opt.extra?.paymentMethod === 'x402-facilitator' &&
          opt.extra?.chainType === 'evm'
      );
      if (x402Option) return x402Option;

      // Fall back to any EVM option
      const evmOption = options.find(opt => opt.extra?.chainType === 'evm');
      if (evmOption) return evmOption;
    }

    // For Phantom, try EVM x402 first, then Solana
    if (wallet?.walletType === 'phantom') {
      // Prefer EVM x402 facilitator if available
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
  };

  // Balance check
  const handleCheckBalance = async (address: string) => {
    setBalanceLoading(true);
    setBalanceResult(null);
    setBalanceError(null);
    setUtxos([]);

    try {
      const [balanceRes, utxoRes] = await Promise.all([
        fetch(`/api/balance/${encodeURIComponent(address)}`),
        fetch(`/api/utxos?address=${encodeURIComponent(address)}`),
      ]);

      const balanceData = await balanceRes.json();
      if (!balanceRes.ok) throw new Error(balanceData.error || 'Failed to get balance');

      const utxoData = await utxoRes.json();
      if (utxoRes.ok) setUtxos(utxoData);

      setBalanceResult({
        balance: balanceData.balance,
        utxoCount: balanceData.utxoCount || utxoData.length,
      });
    } catch (error) {
      setBalanceError(error instanceof Error ? error.message : 'Failed to get balance');
    } finally {
      setBalanceLoading(false);
    }
  };

  // Fetch UTXOs
  const fetchUTXOs = async (address: string): Promise<UTXO[]> => {
    const res = await fetch(`/api/utxos?address=${encodeURIComponent(address)}`);
    if (!res.ok) throw new Error('Failed to fetch UTXOs');
    return res.json();
  };

  // Mint
  const handleMint = async (address: string, amount: number, paymentTxHash?: string) => {
    if (!wallet?.address) {
      setMintError('Please connect your wallet first to mint tokens.');
      return;
    }

    setMintLoading(true);
    setMintResult(null);
    setMintError(null);

    try {
      const chainId = wallet.chainId || 'mocha-4';
      const minterAddress = wallet.address;
      console.log('Minting with minterAddress:', minterAddress);
      const res = await fetch('/api/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, amount, chainId, paymentTxHash, minterAddress }),
      });
      const data = await res.json();

      if (res.status === 402 && data.paymentRequired && data.quote) {
        if (!wallet) {
          setMintError('Payment required. Please connect your wallet first.');
          return;
        }
        setMintResult(`Payment required: ${data.quote.totalCost} TIA. Processing...`);
        await handlePaymentAndRetry(data.quote, (txHash) =>
          handleMintWithPayment(address, amount, txHash)
        );
        return;
      }

      if (!res.ok) throw new Error(data.error || 'Failed to mint');

      setMintResult(`Minted! Created UTXO: ${data.id}:0`);
      loadInfo();
    } catch (error) {
      setMintError(error instanceof Error ? error.message : 'Failed to mint');
    } finally {
      setMintLoading(false);
    }
  };

  const handleMintWithPayment = async (address: string, amount: number, paymentTxHash: string) => {
    const chainId = wallet?.chainId || 'mocha-4';
    const minterAddress = wallet?.address;
    const res = await fetch('/api/mint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, amount, chainId, paymentTxHash, minterAddress }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to mint after payment');
    setMintResult(`Minted! Created UTXO: ${data.id}:0`);
    setMintError(null);
    loadInfo();
    return data;
  };

  // Burn
  const handleBurn = async (
    amount: number,
    paymentTxHash?: string,
    existingSignedRequest?: SignedTransactionRequest
  ) => {
    if (!wallet) {
      setBurnError('Please connect your wallet first.');
      return;
    }

    const fromAddress = wallet.address;

    setBurnLoading(true);
    setBurnResult(null);
    setBurnError(null);

    try {
      let signedRequest = existingSignedRequest;

      if (!signedRequest) {
        setBurnResult('Fetching UTXOs...');
        const addressUtxos = await fetchUTXOs(fromAddress);

        if (addressUtxos.length === 0) {
          throw new Error('No UTXOs found for this address');
        }

        const rawBurnAmount = toRawAmount(amount);
        const { selected, total } = selectUTXOsForAmount(addressUtxos, BigInt(rawBurnAmount));

        if (total < BigInt(rawBurnAmount)) {
          throw new Error(`Insufficient funds: have ${total}, need ${rawBurnAmount}`);
        }

        const change = calculateChange(
          selected.map((u) => ({ utxoId: u.id, amount: u.amount })),
          rawBurnAmount
        );

        const senderChainId = selected[0]?.chainId || wallet.chainId || 'mocha-4';
        const inputs = selected.map((u) => ({ utxoId: u.id, amount: u.amount }));
        const outputs =
          BigInt(change) > 0n ? [{ owner: fromAddress, chainId: senderChainId, amount: change }] : [];

        setBurnResult(`Signing transaction with ${wallet.walletType}...`);
        signedRequest = await walletManager.signTransaction(inputs, outputs, fromAddress);
      }

      const res = await fetch('/api/burn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: fromAddress,
          amount,
          paymentTxHash,
          signedRequest,
        }),
      });
      const data = await res.json();

      if (res.status === 402 && data.paymentRequired && data.quote) {
        setBurnResult(`Payment required: ${data.quote.totalCost} TIA. Processing...`);
        await handlePaymentAndRetry(data.quote, (txHash) =>
          handleBurnWithPayment(amount, txHash, signedRequest!)
        );
        return;
      }

      if (!res.ok) throw new Error(data.error || 'Failed to burn');

      setBurnResult(`Burned! Consumed ${data.inputs.length} UTXO(s)`);
      loadInfo();
    } catch (error) {
      setBurnError(error instanceof Error ? error.message : 'Failed to burn');
    } finally {
      setBurnLoading(false);
    }
  };

  const handleBurnWithPayment = async (
    amount: number,
    paymentTxHash: string,
    signedRequest: SignedTransactionRequest
  ) => {
    const res = await fetch('/api/burn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: wallet!.address,
        amount,
        paymentTxHash,
        signedRequest,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to burn after payment');
    setBurnResult(`Burned! Consumed ${data.inputs.length} UTXO(s)`);
    setBurnError(null);
    loadInfo();
    return data;
  };

  // Transfer
  const handleTransfer = async (
    to: string,
    amount: number,
    paymentTxHash?: string,
    existingSignedRequest?: SignedTransactionRequest
  ) => {
    if (!wallet) {
      setTransferError('Please connect your wallet first.');
      return;
    }

    const fromAddress = wallet.address;

    setTransferLoading(true);
    setTransferResult(null);
    setTransferError(null);

    try {
      let signedRequest = existingSignedRequest;

      if (!signedRequest) {
        setTransferResult('Fetching UTXOs...');
        const senderUtxos = await fetchUTXOs(fromAddress);

        if (senderUtxos.length === 0) {
          throw new Error('No UTXOs found for sender address');
        }

        const rawTransferAmount = toRawAmount(amount);
        const { selected, total } = selectUTXOsForAmount(senderUtxos, BigInt(rawTransferAmount));

        if (total < BigInt(rawTransferAmount)) {
          throw new Error(`Insufficient funds: have ${total}, need ${rawTransferAmount}`);
        }

        const change = calculateChange(
          selected.map((u) => ({ utxoId: u.id, amount: u.amount })),
          rawTransferAmount
        );

        const senderChainId = selected[0]?.chainId || wallet.chainId || 'mocha-4';
        const recipientChainId = detectChainFromAddress(to);
        const inputs = selected.map((u) => ({ utxoId: u.id, amount: u.amount }));
        const outputs = [
          { owner: to, chainId: recipientChainId, amount: rawTransferAmount },
          ...(BigInt(change) > 0n
            ? [{ owner: fromAddress, chainId: senderChainId, amount: change }]
            : []),
        ];

        setTransferResult(`Signing transaction with ${wallet.walletType}...`);
        signedRequest = await walletManager.signTransaction(inputs, outputs, fromAddress);
      }

      const res = await fetch('/api/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromAddress,
          to,
          amount,
          paymentTxHash,
          signedRequest,
        }),
      });
      const data = await res.json();

      if (res.status === 402 && data.paymentRequired && data.quote) {
        setTransferResult(`Payment required: ${data.quote.totalCost} TIA. Processing...`);
        await handlePaymentAndRetry(data.quote, (txHash) =>
          handleTransferWithPayment(to, amount, txHash, signedRequest!)
        );
        return;
      }

      if (!res.ok) throw new Error(data.error || 'Failed to transfer');

      setTransferResult(`Transferred! ${data.inputs.length} in / ${data.outputs.length} out`);
      loadInfo();
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : 'Failed to transfer');
    } finally {
      setTransferLoading(false);
    }
  };

  const handleTransferWithPayment = async (
    to: string,
    amount: number,
    paymentTxHash: string,
    signedRequest: SignedTransactionRequest
  ) => {
    const res = await fetch('/api/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: wallet!.address,
        to,
        amount,
        paymentTxHash,
        signedRequest,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to transfer after payment');
    setTransferResult(`Transferred! ${data.inputs.length} in / ${data.outputs.length} out`);
    setTransferError(null);
    loadInfo();
    return data;
  };

  // History
  const loadHistory = async (address?: string) => {
    setHistoryLoading(true);
    try {
      const url = address ? `/api/history?address=${encodeURIComponent(address)}` : '/api/history';
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load history');
      setTransactions(data);
    } catch (error) {
      console.error('Failed to load history:', error);
      setTransactions([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header
        wallet={wallet}
        availableWallets={availableWallets}
        onConnectWallet={handleConnectWallet}
        onDisconnectWallet={handleDisconnectWallet}
        walletError={walletError}
      />

      <main className="container max-w-6xl mx-auto px-4 py-8 space-y-8">
        <StatsDashboard info={info} />

        <Tabs defaultValue="balance" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-flex">
            <TabsTrigger value="balance" className="gap-2">
              <Wallet className="h-4 w-4 hidden sm:block" />
              Balance
            </TabsTrigger>
            <TabsTrigger value="mint" className="gap-2">
              <Sparkles className="h-4 w-4 hidden sm:block" />
              Mint
            </TabsTrigger>
            <TabsTrigger value="burn" className="gap-2">
              <Flame className="h-4 w-4 hidden sm:block" />
              Burn
            </TabsTrigger>
            <TabsTrigger value="transfer" className="gap-2">
              <Send className="h-4 w-4 hidden sm:block" />
              Transfer
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="h-4 w-4 hidden sm:block" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="balance">
            <BalanceChecker
              symbol={info?.symbol || 'VRSD'}
              decimals={info?.decimals || 6}
              onCheckBalance={handleCheckBalance}
              balanceResult={balanceResult}
              utxos={utxos}
              loading={balanceLoading}
              error={balanceError}
            />
          </TabsContent>

          <TabsContent value="mint">
            <div className="max-w-md">
              <MintCard
                symbol={info?.symbol || 'VRSD'}
                onMint={(address, amount) => handleMint(address, amount)}
                loading={mintLoading}
                result={mintResult}
                error={mintError}
              />
            </div>
          </TabsContent>

          <TabsContent value="burn">
            <div className="max-w-md">
              <BurnCard
                symbol={info?.symbol || 'VRSD'}
                walletAddress={wallet?.address || null}
                onBurn={(amount) => handleBurn(amount)}
                loading={burnLoading}
                result={burnResult}
                error={burnError}
              />
            </div>
          </TabsContent>

          <TabsContent value="transfer">
            <div className="max-w-md">
              <TransferCard
                symbol={info?.symbol || 'VRSD'}
                walletAddress={wallet?.address || null}
                onTransfer={(to, amount) => handleTransfer(to, amount)}
                loading={transferLoading}
                result={transferResult}
                error={transferError}
              />
            </div>
          </TabsContent>

          <TabsContent value="history">
            <TransactionHistory
              transactions={transactions}
              decimals={info?.decimals || 6}
              symbol={info?.symbol || 'VRSD'}
              onLoadHistory={loadHistory}
              loading={historyLoading}
            />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t py-6 mt-8">
        <div className="container max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>VietRSD - UTXO-based Stablecoin on Celestia</p>
          <div className="flex items-center gap-4">
            <a
              href="https://onchaindb.io"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              OnChainDB
            </a>
            <a
              href="https://celestia.org"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Celestia
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
