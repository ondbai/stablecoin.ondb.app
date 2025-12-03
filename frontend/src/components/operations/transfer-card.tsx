'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, AlertCircle, ArrowRight } from 'lucide-react';

interface TransferCardProps {
  symbol: string;
  walletAddress: string | null;
  onTransfer: (to: string, amount: number) => Promise<void>;
  loading: boolean;
  result: string | null;
  error: string | null;
}

export function TransferCard({
  symbol,
  walletAddress,
  onTransfer,
  loading,
  result,
  error,
}: TransferCardProps) {
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (toAddress.trim() && !isNaN(parsedAmount) && parsedAmount > 0) {
      onTransfer(toAddress.trim(), parsedAmount);
    }
  };

  return (
    <Card className="border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-transparent">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Send className="h-4 w-4 text-blue-500" />
          </div>
          <div>
            <CardTitle className="text-lg">Transfer</CardTitle>
            <CardDescription>Send tokens to another address</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="transfer-from">From Address</Label>
            {walletAddress ? (
              <Input
                id="transfer-from"
                value={walletAddress}
                disabled
                className="font-mono text-sm bg-muted"
              />
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-md border border-dashed border-muted-foreground/25 bg-muted/50">
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Connect wallet to transfer tokens
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-center">
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="transfer-to">To Address</Label>
            <Input
              id="transfer-to"
              placeholder="celestia1... or 0x... or Solana address"
              value={toAddress}
              onChange={(e) => setToAddress(e.target.value)}
              disabled={!walletAddress}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="transfer-amount">Amount</Label>
            <div className="relative">
              <Input
                id="transfer-amount"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                step="0.000001"
                min="0"
                disabled={!walletAddress}
                className="pr-16"
              />
              <Badge
                variant="secondary"
                className="absolute right-2 top-1/2 -translate-y-1/2"
              >
                {symbol}
              </Badge>
            </div>
          </div>
          <Button
            type="submit"
            disabled={loading || !walletAddress || !toAddress.trim() || !amount}
            className="w-full"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Send Tokens
          </Button>
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">
              {error}
            </p>
          )}
          {result && (
            <p className="text-sm text-green-600 bg-green-500/10 p-2 rounded">
              {result}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
