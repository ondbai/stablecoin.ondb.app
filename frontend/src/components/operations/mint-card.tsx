'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Sparkles } from 'lucide-react';

interface MintCardProps {
  symbol: string;
  onMint: (address: string, amount: number) => Promise<void>;
  loading: boolean;
  result: string | null;
  error: string | null;
}

export function MintCard({ symbol, onMint, loading, result, error }: MintCardProps) {
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (address.trim() && !isNaN(parsedAmount) && parsedAmount > 0) {
      onMint(address.trim(), parsedAmount);
    }
  };

  return (
    <Card className="border-green-500/20 bg-gradient-to-br from-green-500/5 to-transparent">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-green-500" />
          </div>
          <div>
            <CardTitle className="text-lg">Mint</CardTitle>
            <CardDescription>Create new tokens</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mint-address">Recipient Address</Label>
            <Input
              id="mint-address"
              placeholder="celestia1... or 0x... or Solana address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mint-amount">Amount</Label>
            <div className="relative">
              <Input
                id="mint-amount"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                step="0.000001"
                min="0"
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
            disabled={loading || !address.trim() || !amount}
            className="w-full bg-green-600 hover:bg-green-700"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Mint Tokens
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
