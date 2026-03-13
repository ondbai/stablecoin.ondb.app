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
import { Loader2, Search, Wallet, Copy, Check } from 'lucide-react';

interface UTXO {
  id: string;
  owner: string;
  chainId: string;
  amount: string;
  spent: boolean;
  createdInTx: string;
  createdAt: string;
}

interface BalanceCheckerProps {
  symbol: string;
  decimals: number;
  onCheckBalance: (address: string) => Promise<void>;
  balanceResult: { balance: number; utxoCount: number } | null;
  utxos: UTXO[];
  loading: boolean;
  error: string | null;
}

export function BalanceChecker({
  symbol,
  decimals,
  onCheckBalance,
  balanceResult,
  utxos,
  loading,
  error,
}: BalanceCheckerProps) {
  const [address, setAddress] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (address.trim()) {
      onCheckBalance(address.trim());
    }
  };

  const formatAmount = (amount: string) => {
    return (parseInt(amount) / Math.pow(10, decimals)).toLocaleString(undefined, {
      maximumFractionDigits: 6,
    });
  };

  const formatId = (id: string) => {
    if (id.length <= 20) return id;
    return `${id.slice(0, 10)}...${id.slice(-6)}`;
  };

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Wallet className="h-4 w-4 text-purple-500" />
          </div>
          <div>
            <CardTitle className="text-lg">Balance & UTXOs</CardTitle>
            <CardDescription>Check balance and view unspent outputs</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <div className="flex-1">
            <Label htmlFor="balance-address" className="sr-only">
              Address
            </Label>
            <Input
              id="balance-address"
              placeholder="Enter address to check balance..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <Button type="submit" disabled={loading || !address.trim()}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            <span className="ml-2 hidden sm:inline">Check</span>
          </Button>
        </form>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
            {error}
          </p>
        )}

        {balanceResult && (
          <div className="flex items-center justify-between p-4 rounded-lg bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20">
            <div>
              <p className="text-sm text-muted-foreground">Total Balance</p>
              <p className="text-2xl font-bold">
                {balanceResult.balance.toLocaleString(undefined, {
                  maximumFractionDigits: 6,
                })}
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  {symbol}
                </span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">UTXOs</p>
              <Badge variant="secondary" className="text-lg">
                {balanceResult.utxoCount}
              </Badge>
            </div>
          </div>
        )}

        {utxos.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              Unspent UTXOs
              <Badge variant="outline" className="font-normal">
                {utxos.length} available
              </Badge>
            </h4>
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[200px]">UTXO ID</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead className="hidden md:table-cell">Chain</TableHead>
                    <TableHead className="hidden lg:table-cell">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {utxos.map((utxo) => (
                    <TableRow key={utxo.id} className="group">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="text-xs">{formatId(utxo.id)}</code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => copyId(utxo.id)}
                          >
                            {copiedId === utxo.id ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono font-medium">
                        {formatAmount(utxo.amount)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline" className="text-xs">
                          {utxo.chainId}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">
                        {new Date(utxo.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
