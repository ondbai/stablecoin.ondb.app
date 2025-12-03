'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Flame, AlertCircle } from 'lucide-react';

interface BurnCardProps {
  symbol: string;
  walletAddress: string | null;
  onBurn: (amount: number) => Promise<void>;
  loading: boolean;
  result: string | null;
  error: string | null;
}

export function BurnCard({
  symbol,
  walletAddress,
  onBurn,
  loading,
  result,
  error,
}: BurnCardProps) {
  const [amount, setAmount] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!isNaN(parsedAmount) && parsedAmount > 0) {
      onBurn(parsedAmount);
    }
  };

  return (
    <Card className="border-red-500/20 bg-gradient-to-br from-red-500/5 to-transparent">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-red-500/10 flex items-center justify-center">
            <Flame className="h-4 w-4 text-red-500" />
          </div>
          <div>
            <CardTitle className="text-lg">Burn</CardTitle>
            <CardDescription>Destroy tokens from wallet</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="burn-address">From Address</Label>
            {walletAddress ? (
              <Input
                id="burn-address"
                value={walletAddress}
                disabled
                className="font-mono text-sm bg-muted"
              />
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-md border border-dashed border-muted-foreground/25 bg-muted/50">
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Connect wallet to burn tokens
                </span>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="burn-amount">Amount to Burn</Label>
            <div className="relative">
              <Input
                id="burn-amount"
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
            disabled={loading || !walletAddress || !amount}
            variant="destructive"
            className="w-full"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Flame className="mr-2 h-4 w-4" />
            )}
            Burn Tokens
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
