'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, Coins, Activity } from 'lucide-react';

interface StablecoinInfo {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  totalMinted?: string;
  totalBurned?: string;
  totalTransactions?: number;
}

interface StatsDashboardProps {
  info: StablecoinInfo | null;
}

export function StatsDashboard({ info }: StatsDashboardProps) {
  const formatSupply = () => {
    if (!info) return '--';
    const supply = parseInt(info.totalSupply) / Math.pow(10, info.decimals);
    return supply.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const formatAmount = (amount: string | undefined) => {
    if (!amount || !info) return '--';
    const value = parseInt(amount) / Math.pow(10, info.decimals);
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  if (!info) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-20 mb-1" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const stats = [
    {
      title: 'Circulating Supply',
      value: formatSupply(),
      suffix: info.symbol,
      icon: Coins,
      description: 'Total tokens in circulation',
      color: 'text-blue-500',
    },
    {
      title: 'Total Minted',
      value: formatAmount(info.totalMinted),
      suffix: info.symbol,
      icon: TrendingUp,
      description: 'All-time tokens created',
      color: 'text-green-500',
    },
    {
      title: 'Total Burned',
      value: formatAmount(info.totalBurned),
      suffix: info.symbol,
      icon: TrendingDown,
      description: 'All-time tokens destroyed',
      color: 'text-red-500',
    },
    {
      title: 'Transactions',
      value: info.totalTransactions?.toLocaleString() || '--',
      suffix: '',
      icon: Activity,
      description: 'Total UTXO transactions',
      color: 'text-purple-500',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <Card key={stat.title} className="relative overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {stat.title}
            </CardTitle>
            <stat.icon className={`h-4 w-4 ${stat.color}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stat.value}
              {stat.suffix && (
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  {stat.suffix}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
          </CardContent>
          <div
            className={`absolute inset-0 bg-gradient-to-br ${stat.color.replace('text-', 'from-')}/5 to-transparent pointer-events-none`}
          />
        </Card>
      ))}
    </div>
  );
}
