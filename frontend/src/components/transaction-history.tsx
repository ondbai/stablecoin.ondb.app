'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Loader2, History, ArrowUpRight, ArrowDownLeft, Flame, Sparkles, RefreshCw } from 'lucide-react';

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

interface TransactionHistoryProps {
  transactions: Transaction[];
  decimals: number;
  symbol: string;
  onLoadHistory: (address?: string) => Promise<void>;
  loading: boolean;
}

const CHAIN_NAMES: Record<string, string> = {
  'mocha-4': 'Mocha',
  celestia: 'Celestia',
  cosmos: 'Cosmos',
  osmosis: 'Osmosis',
  'solana-mainnet': 'Solana',
  'solana-devnet': 'Sol-Dev',
  'eip155:1': 'Ethereum',
  'eip155:137': 'Polygon',
  'eip155:42161': 'Arbitrum',
  'eip155:10': 'Optimism',
  'eip155:8453': 'Base',
  'eip155:11155111': 'Sepolia',
  unknown: 'Unknown',
};

function detectChainFromAddress(address: string): string {
  if (address.startsWith('celestia')) return 'mocha-4';
  if (address.startsWith('cosmos')) return 'cosmos';
  if (address.startsWith('osmo')) return 'osmosis';
  if (address.startsWith('0x')) return 'eip155:1';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return 'solana-mainnet';
  return 'unknown';
}

export function TransactionHistory({
  transactions,
  decimals,
  symbol,
  onLoadHistory,
  loading,
}: TransactionHistoryProps) {
  const [filterAddress, setFilterAddress] = useState('');

  const handleLoad = () => {
    onLoadHistory(filterAddress.trim() || undefined);
  };

  const formatAmount = (amount: string) => {
    return (parseInt(amount) / Math.pow(10, decimals)).toLocaleString(undefined, {
      maximumFractionDigits: 6,
    });
  };

  const formatAddress = (addr: string) => {
    if (addr === 'system' || addr === 'burned') return addr;
    if (addr.length <= 16) return addr;
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
  };

  const getFromAddress = (tx: Transaction) => {
    if (tx.type === 'mint') return 'system';
    return tx.inputs[0]?.owner || 'unknown';
  };

  const getToAddress = (tx: Transaction) => {
    if (tx.type === 'burn') return 'burned';
    const fromAddr = getFromAddress(tx);
    const recipient = tx.outputs.find((o) => o.owner !== fromAddr);
    return recipient?.owner || tx.outputs[0]?.owner || 'unknown';
  };

  const getTransferAmount = (tx: Transaction) => {
    if (tx.type === 'mint') return tx.outputs[0]?.amount || '0';
    if (tx.type === 'burn') {
      const inputSum = tx.inputs.reduce((sum, i) => sum + BigInt(i.amount), 0n);
      const outputSum = tx.outputs.reduce((sum, o) => sum + BigInt(o.amount), 0n);
      return (inputSum - outputSum).toString();
    }
    const fromAddr = getFromAddress(tx);
    const recipient = tx.outputs.find((o) => o.owner !== fromAddr);
    return recipient?.amount || tx.outputs[0]?.amount || '0';
  };

  const getFromChainId = (tx: Transaction) => {
    if (tx.type === 'mint') return null;
    const input = tx.inputs[0];
    if (!input) return null;
    return input.chainId || detectChainFromAddress(input.owner);
  };

  const getToChainId = (tx: Transaction) => {
    if (tx.type === 'burn') return null;
    const fromAddr = getFromAddress(tx);
    const recipient = tx.outputs.find((o) => o.owner !== fromAddr);
    const output = recipient || tx.outputs[0];
    if (!output) return null;
    return output.chainId || detectChainFromAddress(output.owner);
  };

  const formatChainId = (chainId: string | null) => {
    if (!chainId) return null;
    return CHAIN_NAMES[chainId] || chainId;
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'mint':
        return <Sparkles className="h-4 w-4" />;
      case 'burn':
        return <Flame className="h-4 w-4" />;
      case 'transfer':
        return <ArrowUpRight className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const getTypeBadgeClass = (type: string) => {
    switch (type) {
      case 'mint':
        return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'burn':
        return 'bg-red-500/10 text-red-600 border-red-500/20';
      case 'transfer':
        return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
      default:
        return '';
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <History className="h-4 w-4 text-orange-500" />
            </div>
            <div>
              <CardTitle className="text-lg">Transaction History</CardTitle>
              <CardDescription>UTXO-based transaction ledger</CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="hidden sm:flex">
            {transactions.length} transactions
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3">
          <div className="flex-1">
            <Label htmlFor="history-address" className="sr-only">
              Filter by address
            </Label>
            <Input
              id="history-address"
              placeholder="Filter by address (optional)"
              value={filterAddress}
              onChange={(e) => setFilterAddress(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <Button onClick={handleLoad} disabled={loading} variant="outline">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2 hidden sm:inline">Load</span>
          </Button>
        </div>

        {transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <History className="h-12 w-12 text-muted-foreground/20 mb-4" />
            <p className="text-muted-foreground">No transactions found</p>
            <p className="text-sm text-muted-foreground/70">
              Click Load to fetch transaction history
            </p>
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[100px]">Type</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="hidden md:table-cell text-center">I/O</TableHead>
                    <TableHead className="hidden lg:table-cell">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.id} className="group">
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`flex items-center gap-1 w-fit ${getTypeBadgeClass(tx.type)}`}
                        >
                          {getTypeIcon(tx.type)}
                          {tx.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-mono text-xs">
                                {formatAddress(getFromAddress(tx))}
                              </span>
                              {getFromChainId(tx) && (
                                <Badge variant="outline" className="text-[10px] w-fit">
                                  {formatChainId(getFromChainId(tx))}
                                </Badge>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="font-mono text-xs">{getFromAddress(tx)}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-mono text-xs">
                                {formatAddress(getToAddress(tx))}
                              </span>
                              {getToChainId(tx) && (
                                <Badge variant="outline" className="text-[10px] w-fit">
                                  {formatChainId(getToChainId(tx))}
                                </Badge>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="font-mono text-xs">{getToAddress(tx)}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatAmount(getTransferAmount(tx))}
                        <span className="text-muted-foreground text-xs ml-1">{symbol}</span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-center">
                        <span className="text-xs text-muted-foreground">
                          {tx.inputs.length} / {tx.outputs.length}
                        </span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">
                        {new Date(tx.timestamp).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TooltipProvider>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
